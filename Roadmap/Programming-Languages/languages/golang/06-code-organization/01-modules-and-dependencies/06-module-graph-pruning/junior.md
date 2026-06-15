# Module Graph Pruning — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "Why did my `go.mod` suddenly get bigger?" and "What is the module *graph*, and why does Go prune it?"

When you run a `go` command — `go build`, `go test`, `go list` — Go does not only look at *your* `go.mod`. It builds a **module graph**: a map of every module your project depends on, and every module *those* modules depend on, and so on, all the way down. Each module contributes its own `go.mod` to the graph.

Before Go 1.17, that graph was *enormous*. To build even a tiny program, Go loaded the `go.mod` of every module in the entire transitive tree — including dependencies of dependencies of dependencies that your code never actually touched. On a big project that meant reading thousands of `go.mod` files just to start a build.

Go 1.17 introduced **module graph pruning** to fix this. The idea is simple:

> Only load the part of the graph that is actually relevant to building and testing *your* module. Prune away the rest.

```bash
go version   # must be 1.17 or newer for pruning to exist
```

The trigger is one line in your `go.mod`:

```
go 1.17
```

If the `go` directive says `1.17` or higher, your module gets a **pruned** graph. If it says `1.16` or lower, it gets the old **full** (unpruned) graph. That single line changes how much of the universe Go has to load.

After reading this file you will:
- Understand what the module graph is
- Understand what pruning removes and why
- Know why `go.mod` got bigger in Go 1.17 (the second `require` block)
- Read a modern pruned `go.mod` line by line
- Run `go mod tidy` and understand its `// indirect` output
- Know the role of the `go` directive in turning pruning on

You do **not** need to understand MVS internals, the pruning algorithm, or `-compat` deeply yet. This file is about the moment you open a `go.mod` from a modern project, see two `require` blocks and a pile of `// indirect` lines, and want to know *why*.

---

## Prerequisites

- **Required:** A working Go installation, version 1.17 or newer. Pruning was introduced in 1.17. In 2026 you are almost certainly on 1.21+. Check with `go version`.
- **Required:** A Go module — a folder with a `go.mod` file. If you are unsure, see [01-go-mod-init/junior.md](../01-go-mod-init/junior.md).
- **Required:** Familiarity with `go mod tidy`. Pruning changes what `tidy` records. See [02-go-mod-tidy/junior.md](../02-go-mod-tidy/junior.md).
- **Helpful:** A basic sense of what a *transitive dependency* is (a dependency of a dependency).
- **Helpful:** Having added a couple of third-party libraries with `go get`, so your `go.mod` has some `require` lines to look at.

If `go version` prints `go version go1.17` or higher, you have pruning. If it prints `1.16` or lower, upgrade — those versions are years past end-of-life.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Module graph** | The directed graph of every module reachable from your `go.mod` via `require` edges. Each module contributes its own `go.mod`. |
| **Full (unpruned) graph** | The pre-1.17 graph: the transitive closure of *every* dependency's requirements, loaded in full. |
| **Pruned graph** | The 1.17+ graph: only the `go.mod` files of modules directly relevant to building/testing the main module. |
| **The `go` directive** | The `go 1.x` line in `go.mod`. At `1.17`+ it turns on pruning for that module. |
| **Main module** | The module you are currently working in — the one whose `go.mod` is at the root of your build. |
| **Direct dependency** | A module your own code imports a package from. Listed in `go.mod` without `// indirect`. |
| **Indirect dependency** | A module you do not import directly, but that something in your build needs. Marked `// indirect`. |
| **Lazy module loading** | The 1.17 companion feature: Go avoids loading the full graph unless it truly has to. |
| **`go mod tidy`** | The command that adds missing and removes unused requirements, keeping `go.mod` self-contained. |
| **MVS** | Minimal Version Selection — the algorithm that picks one version per module from the graph. See [04-minimal-version-selection-mvs](../04-minimal-version-selection-mvs/junior.md). |
| **Build list** | The final set of `(module, version)` pairs chosen for the build. |

---

## Core Concepts

### What the module graph is

Imagine your project requires module `A`. `A`'s `go.mod` requires `B` and `C`. `B`'s `go.mod` requires `D`. The module graph is the whole web:

```
you → A → B → D
        → C
```

To pick the correct versions, Go reads `go.mod` files along these edges. The question pruning answers is: *how many of these `go.mod` files does Go actually need to read?*

### The full graph (pre-1.17): read everything

Before Go 1.17, Go loaded *every* `go.mod` in the transitive closure — `A`, `B`, `C`, `D`, and everything below them, even modules that only mattered for `D`'s own tests or `D`'s own niche features that your code never reaches.

On a small project this is fine. On a large one (think Kubernetes, or any service with hundreds of dependencies), it meant loading thousands of `go.mod` files for *every* `go` command. Slow, and full of irrelevant detail.

### The pruned graph (1.17+): read only what matters

Pruning says: load the `go.mod` files of your **direct** dependencies, plus enough of their dependencies to cover what you actually import — and stop there. The deep, irrelevant parts of the graph are *pruned away*.

The trade-off: for the graph to stay *self-contained* (so the build is reproducible without loading those pruned parts), your own `go.mod` must now record a few more `// indirect` requirements than before. Go writes them for you. That is why modern `go.mod` files are bigger.

### The `go` directive is the switch

```
go 1.17
```

- `go 1.17` or higher → **pruned** graph. Bigger `go.mod`, faster commands.
- `go 1.16` or lower → **full** graph. Smaller `go.mod`, slower commands, old behaviour.

You opt in by bumping the directive and running `go mod tidy`. Go fills in the extra indirect requirements automatically.

### Why `go.mod` grew: the second `require` block

In a pruned module, `go.mod` must list enough indirect dependencies to describe the build on its own — without Go having to load the deep graph to find them. So a tidy modern `go.mod` typically has **two** `require` blocks:

```
require (
    github.com/spf13/cobra v1.8.0   // your direct deps
    github.com/google/uuid v1.6.0
)

require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
    // ... more indirect deps ...
)
```

The first block is what *you* import. The second block, all marked `// indirect`, is what your dependencies pull in — recorded so the pruned graph is complete. This convention (direct in one block, indirect in another) is what `go mod tidy` produces.

### Pruning does not change *which* versions you get

This is the key reassurance. Pruning changes *how much of the graph Go loads*, not *which versions it selects*. MVS still picks the same versions. Your build is the same — it is just computed faster. (There are rare deepening cases, covered at higher levels, but for everyday work: same versions, faster.)

---

## Real-World Analogies

**1. A company org chart you actually need.** You are planning a meeting with the Engineering VP. You do not need the full org chart of every employee in the company — only the VP, their direct reports, and anyone those reports say you must include. Pruning is loading just the relevant branch of the org chart instead of the whole company directory.

**2. Packing for a trip with a checklist.** The full graph is "bring one of everything you own, just in case." The pruned graph is "bring what this trip needs, plus the few extras the itinerary specifically calls for." Your `go.mod`'s indirect block is that short list of extras written down so you do not have to re-derive it every morning.

**3. A recipe that lists sub-ingredients.** A cake recipe could say "make frosting" and force you to go find the frosting recipe, which references the sugar recipe, and so on. A *self-contained* recipe instead lists every ingredient at the top — flour, sugar, butter — so you can shop in one pass. The indirect `require` block is that flat shopping list.

**4. A map zoomed to your route.** Old Go loaded the whole world map to plan a drive across town. Pruned Go loads just the streets along your route plus the few connecting roads you might take. Same destination, far less paper.

---

## Mental Models

### Model 1 — Pruning is about *loading*, not *selecting*

Pruning changes which `go.mod` files Go reads. It does not change which versions MVS selects for packages you actually build. Same binary, less reading.

### Model 2 — `go.mod` becomes self-contained

A pruned `go.mod` is designed to describe the entire build *by itself*. That is why it lists indirect dependencies: so Go does not have to crawl the deep graph to find them. Bigger file, smaller graph to load.

### Model 3 — Two `require` blocks = direct vs indirect

Block one: "things my code imports." Block two: "things needed to make block one work, recorded for me." `go mod tidy` maintains both. You rarely edit either by hand.

### Model 4 — The `go` directive is a feature flag

`go 1.17` is not just documentation of "minimum Go version." For pruning, it is the *on switch*. Flip it from `1.16` to `1.17`, tidy, and your module's loading behaviour changes.

### Model 5 — Pruning prunes *the graph*, `tidy` prunes *unused requires*

Two different "prunings." Graph pruning (this topic) trims what Go *loads*. `go mod tidy` trims requirements you no longer *use*. They cooperate but are not the same operation.

---

## Pros & Cons

### Pros

- **Faster `go` commands.** Less of the graph is loaded, so `go build`, `go list`, and friends start quicker — dramatically so on large dependency trees.
- **Smaller graph to reason about.** `go mod graph` prints fewer edges; the relevant ones are easier to see.
- **More reproducible.** A self-contained `go.mod` means the build does not depend on fetching deep, irrelevant `go.mod` files.
- **Better offline behaviour.** Fewer `go.mod` files to fetch means fewer network trips and fewer "could not load module graph" failures behind restricted networks.

### Cons

- **Bigger `go.mod`.** The indirect `require` block can be long. This surprises newcomers.
- **More to keep tidy.** Every dependency change can shuffle the indirect block, producing larger `go.mod` diffs.
- **Two regimes to understand.** Modules at `go 1.16` and `go 1.17+` behave differently; mixing them in your head is confusing at first.
- **Subtle migration moments.** Bumping the `go` directive plus `go mod tidy` can change `go.mod` noticeably in one commit.

For the vast majority of projects, pruning is a pure win you get automatically by being on a modern `go` directive.

---

## Use Cases

You benefit from pruning whenever:

- **Your project has many dependencies.** The more transitive modules, the bigger the speedup.
- **You run `go` commands frequently** (every save in an IDE, every CI step). Faster graph loading compounds.
- **You build in CI with limited network** access. Fewer `go.mod` fetches means fewer flakes.
- **You read `go mod graph` to debug** dependency questions. A pruned graph is far more legible.
- **You care about reproducible builds.** A self-contained `go.mod` is a stronger guarantee.

You do **not** need to think about pruning when:

- Your project is tiny with two or three dependencies — the speedup is real but invisible.
- You are on an old `go` directive intentionally for compatibility (rare in 2026).
- You only ever consume modules and never inspect their graphs.

But note: even tiny modern projects *get* pruning automatically because `go mod init` writes a recent `go` directive. You benefit whether or not you think about it.

---

## Code Examples

### Example 1 — Create a pruned module and look at `go.mod`

```bash
mkdir prunedemo
cd prunedemo
go mod init example.com/prunedemo
cat go.mod
```

A fresh `go.mod` on a modern Go:

```
module example.com/prunedemo

go 1.23
```

The `go 1.23` directive means this module is pruned from the start.

### Example 2 — Add a dependency and watch the indirect block appear

Write `main.go` using `cobra`, which has several transitive dependencies:

```go
package main

import (
    "fmt"

    "github.com/spf13/cobra"
)

func main() {
    root := &cobra.Command{
        Use: "demo",
        Run: func(cmd *cobra.Command, args []string) {
            fmt.Println("hello from demo")
        },
    }
    _ = root.Execute()
}
```

Tidy:

```bash
go mod tidy
cat go.mod
```

You will see something like:

```
module example.com/prunedemo

go 1.23

require github.com/spf13/cobra v1.8.0

require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
)
```

The single direct dependency (`cobra`) is in the first `require`. The two indirect dependencies that `cobra` needs are recorded in the second block. This is pruning in action: `go.mod` lists what is needed so the deep graph does not have to be loaded.

### Example 3 — Read the two blocks

```
require github.com/spf13/cobra v1.8.0
```

This is **direct**: your `main.go` imports `github.com/spf13/cobra`.

```
require (
    github.com/inconshreveable/mousetrap v1.1.0 // indirect
    github.com/spf13/pflag v1.0.5 // indirect
)
```

These are **indirect**: you never import them, but `cobra` does, so they are recorded to keep the pruned `go.mod` self-contained.

### Example 4 — See the pruned graph

```bash
go mod graph
```

Each line is `from@version to@version`, one edge of the graph. On a pruned module this output is shorter and more focused than it would have been pre-1.17.

### Example 5 — Compare against an old `go` directive

Temporarily downgrade the directive to see the difference (do not commit this):

```bash
go mod edit -go=1.16
go mod tidy
cat go.mod
```

With `go 1.16`, Go uses the **full** graph. The `go.mod` `tidy` produces records *fewer* indirect dependencies (only those needed for completeness under the old rules), because the full graph is loaded to fill gaps at build time instead of being recorded up front. Restore it:

```bash
go mod edit -go=1.23
go mod tidy
```

### Example 6 — Confirm the build is identical

```bash
go build ./...
go list -m all
```

`go list -m all` prints the build list — the selected version of every module. Pruning did not change these versions; it only changed how Go computed them. Same build, faster.

---

## Coding Patterns

### Pattern: bump the `go` directive deliberately

When you want pruning (you almost always do), set a modern directive and tidy:

```bash
go mod edit -go=1.21
go mod tidy
git add go.mod go.sum
git commit -m "Enable module graph pruning (go 1.21)"
```

Do this as its *own* commit. The `go.mod` diff will be large (the indirect block grows); isolating it keeps that diff out of feature reviews.

### Pattern: tidy after every dependency change

```bash
go get example.com/foo@v1.5.0
go mod tidy
```

`tidy` re-derives the indirect block for the pruned graph. Skipping it leaves `go.mod` inconsistent.

### Pattern: CI verification that `go.mod` is tidy

```bash
go mod tidy
git diff --exit-code go.mod go.sum
```

If `tidy` would change anything, a contributor forgot to run it. This catches stale indirect blocks.

### Pattern: do not hand-curate the indirect block

The second `require` block is generated. Resist the urge to delete `// indirect` lines you "do not recognise" — they are there to keep the pruned graph complete. `go mod tidy` owns that block.

---

## Clean Code

- **Keep the `go` directive current.** A modern directive (`go 1.21`+) gives you pruning and clearer `go.mod` files.
- **Let `go mod tidy` manage the indirect block.** Never hand-edit `// indirect` lines.
- **Commit `go.mod` and `go.sum` together.** They are a pair; splitting them leaves the repo inconsistent.
- **Isolate `go`-directive bumps** in their own commit so the large `go.mod` diff is reviewable on its own.
- **Run `tidy` before pushing.** A CI gate (above) makes this non-optional.
- **Read `go.mod`, not just diffs.** The two-block structure tells you direct-vs-indirect at a glance.

---

## Product Use / Feature

Pruning affects everyday product work mostly through speed and clarity:

- **Faster local feedback.** IDE `go` invocations and `go test` on save start quicker because the graph load is cheaper.
- **Faster CI.** Every `go` step in the pipeline benefits, multiplied across jobs.
- **Cleaner dependency review.** The two-block `go.mod` makes "what do we directly depend on?" answerable by reading the first block.
- **Fewer network surprises.** A self-contained `go.mod` reduces the deep `go.mod` fetches that fail behind corporate proxies.

You will rarely *configure* pruning — it is on by default for modern modules. You benefit from it passively, every day.

---

## Error Handling

Pruning itself rarely produces errors; the surrounding `go.mod` discipline does.

### "go.mod file indicates go 1.16, but maximum version supported by tidy is ..."

You ran `go mod tidy` flags incompatible with your directive. Fix: align the `-go` flag (or the directive) with your toolchain. Usually just `go mod tidy` with no extra flags.

### "missing go.sum entry for module providing package ..."

A package's module is in the graph but its hash is missing from `go.sum`. Fix: `go mod tidy` (or `go mod download`) to populate `go.sum`.

### "updates to go.mod needed; to update it: go mod tidy"

You built with `-mod=readonly` (the default) and the pruned `go.mod` is missing a required indirect entry. Fix: `go mod tidy`, commit the result.

### `go.mod` keeps growing on every `tidy`

Not an error — expected. Each new dependency can add indirect entries. If it grows *unexpectedly*, a dependency added a new requirement; check `go mod why` for the surprising module.

### Inconsistent `go.mod` after a merge

A merge brought in `require` lines from another branch without re-tidying. Fix: `go mod tidy`, resolve, commit.

---

## Security Considerations

- **`go.sum` still protects you.** Pruning changes which `go.mod` files load, not the integrity guarantees. Every module that ends up in your build is still hash-verified against `go.sum`.
- **A self-contained `go.mod` is auditable.** The indirect block makes the *recorded* dependency set explicit, which helps reviewers and SBOM tools see what is in scope.
- **Do not delete indirect entries to "clean up."** Removing a `// indirect` line can make the pruned graph incomplete and, at worst, change which versions get selected. Let `tidy` manage it.
- **Vulnerability scanning is unaffected.** `govulncheck` analyses the actual build, which pruning does not change. Run it as usual.
- **Smaller graphs reduce attack surface for graph-load tooling**, but the real security boundary remains `go.sum` plus your review of dependency changes.

---

## Performance Tips

- **The whole point is performance.** Being on a `go 1.17+` directive is the single biggest "optimization" — it makes graph loading cheap.
- **Keep dependencies tidy.** Unused requires bloat the indirect block and the graph. `go mod tidy` regularly.
- **Prefer modern dependencies.** Libraries whose own `go.mod` is at `go 1.17+` participate in pruning better, keeping the deep graph small.
- **Use `go mod graph | wc -l`** to see how many edges your graph has. A pruned module's number is much smaller than the equivalent unpruned one.
- **Do not downgrade the directive** to shrink `go.mod`. You would trade a small file for a slow, full-graph build. The pruned, larger `go.mod` is the faster choice.

---

## Best Practices

1. **Stay on a modern `go` directive.** `go 1.21`+ in 2026. Pruning is automatic.
2. **Run `go mod tidy` after every dependency change.** It keeps the indirect block correct.
3. **Verify tidiness in CI** with `git diff --exit-code go.mod go.sum`.
4. **Isolate `go`-directive bumps** in dedicated commits.
5. **Trust the indirect block.** Do not hand-prune it.
6. **Read the two-block structure** to understand direct vs indirect at a glance.
7. **Commit `go.mod` and `go.sum` together.**
8. **Upgrade old modules.** A `go 1.16` module misses pruning entirely; bump and tidy.

---

## Edge Cases & Pitfalls

### Pitfall 1 — "My `go.mod` exploded, did I do something wrong?"

No. Bumping to `go 1.17+` and running `tidy` legitimately adds many `// indirect` lines. That is pruning making `go.mod` self-contained. The file is bigger *on purpose*.

### Pitfall 2 — Deleting indirect lines to shrink the file

Every junior tries this. Removing a `// indirect` entry can break the pruned graph's completeness and is undone (or flagged) by the next `tidy`. Leave the block alone.

### Pitfall 3 — Forgetting to tidy after `go get`

You add a dependency but skip `tidy`. The indirect block is now stale, and CI's `-mod=readonly` build fails with "updates to go.mod needed." Always `go get` then `go mod tidy`.

### Pitfall 4 — Confusing graph pruning with `tidy`'s pruning

`go mod tidy` removes *unused* requires. Module graph pruning trims what Go *loads*. Different operations; both involve the word "prune."

### Pitfall 5 — Expecting pruning to change versions

Pruning loads less of the graph but selects the same versions (except rare deepening cases at senior level). If a version changed, something else (a `go get`, a new requirement) caused it, not pruning.

### Pitfall 6 — Mixing old and new directives in a monorepo

A repo with some `go 1.16` modules and some `go 1.21` modules behaves inconsistently. Standardize on a modern directive everywhere.

### Pitfall 7 — Reading `go mod graph` and expecting the old size

A pruned graph is intentionally smaller. If you remember a huge graph from pre-1.17, the new compact output is correct, not truncated.

---

## Common Mistakes

- **Hand-editing the `// indirect` block.** It is generated. Use `go mod tidy`.
- **Skipping `go mod tidy` after dependency changes.** Leaves the indirect block stale.
- **Staying on an old `go` directive** to keep `go.mod` small. You lose pruning's speed.
- **Assuming pruning changed your versions.** It almost never does.
- **Treating the two `require` blocks as a mistake** and merging or deleting them. The split is intentional.
- **Committing `go.mod` without `go.sum`** (or vice versa).
- **Mixing `go 1.16` and `go 1.21` modules** in one repo without realizing they load graphs differently.

---

## Common Misconceptions

> *"Pruning makes my project smaller."*

It makes the *graph Go loads* smaller, but it makes your `go.mod` file *bigger* (the indirect block). Net effect: faster commands, larger `go.mod`.

> *"The indirect block is bloat I should clean up."*

No. Those entries keep the pruned graph self-contained. Deleting them breaks the model; `tidy` owns them.

> *"Pruning changes which dependency versions I use."*

Almost never. It changes how the graph is loaded, not what MVS selects. (Rare deepening cases exist; see senior level.)

> *"I have to enable pruning manually."*

You enable it via the `go` directive — and `go mod init` already writes a modern one. It is on by default for new modules.

> *"Pruning is a build flag."*

No. It is governed by the `go 1.x` directive in `go.mod`, not by a command-line flag.

> *"My old `go 1.15` project is pruned too."*

No. Modules at `go 1.16` or lower use the full graph. Only `go 1.17+` modules are pruned.

---

## Tricky Points

- **The `go` directive is the switch.** `1.17`+ → pruned; `1.16`- → full. One line decides.
- **`go.mod` grew on purpose.** A self-contained pruned `go.mod` must list more indirect deps.
- **Two `require` blocks is the convention,** not a rule — `tidy` produces direct in one, indirect in another for readability. A single block also works.
- **Pruning is per-main-module.** Whether *you* prune depends on *your* `go.mod`'s directive, not your dependencies'.
- **`go mod graph` reflects pruning.** Its output is smaller for pruned modules.
- **MVS still runs.** Pruning feeds MVS a smaller graph; MVS still picks one version per module. See [04-minimal-version-selection-mvs](../04-minimal-version-selection-mvs/junior.md).
- **`go.sum` is independent.** Integrity hashing happens regardless of pruning.

---

## Test

Try this in a scratch folder.

```bash
mkdir prune-test
cd prune-test
go mod init example.com/pt
cat > main.go <<'EOF'
package main

import (
    "fmt"
    "github.com/spf13/cobra"
)

func main() {
    c := &cobra.Command{Use: "pt"}
    fmt.Println(c.Use)
}
EOF
go mod tidy
cat go.mod
go mod graph | wc -l
```

Expected: a `go.mod` with a `go 1.2x` directive, a direct `require` for `cobra`, and a second `require` block of `// indirect` entries.

Now answer:
1. Which line in `go.mod` turns pruning on? (Answer: the `go 1.17`-or-higher directive.)
2. Why is `github.com/spf13/pflag` marked `// indirect`? (Answer: your code does not import it; `cobra` does.)
3. If you set the directive to `go 1.16` and re-tidy, does the indirect block get larger or smaller? (Answer: typically smaller — the full graph fills gaps at load time instead of being recorded.)
4. Did pruning change which version of `cobra` you got? (Answer: no.)

---

## Tricky Questions

**Q1.** My `go.mod` has two `require` blocks. Did `go mod tidy` make a mistake?

A. No. `tidy` deliberately splits direct dependencies into one block and `// indirect` dependencies into another for readability. Both blocks are valid `require` directives; the split is cosmetic but conventional.

**Q2.** Why does a pruned `go.mod` list *more* indirect dependencies than an unpruned one?

A. So the `go.mod` is self-contained. With pruning, Go does not load the deep graph, so the indirect deps that the deep graph would have provided must be recorded directly in your `go.mod`.

**Q3.** I bumped `go 1.16` to `go 1.21` and `go mod tidy` rewrote half my `go.mod`. Is that normal?

A. Yes. Crossing the 1.17 boundary switches you from the full graph to the pruned graph, which changes how many indirect deps are recorded. Commit it as its own change.

**Q4.** Does pruning make my binary smaller or faster?

A. No. Pruning speeds up `go` *commands* (graph loading). The compiled binary is unchanged.

**Q5.** Can I turn pruning off?

A. Effectively, yes — set the `go` directive to `1.16` or lower. But you would lose the speed benefit and gain nothing. Do not do this without a specific reason.

**Q6.** Are my dependencies pruned, or just my module?

A. Pruning applies to the **main module** — the one you build. Whether the graph is pruned depends on *your* `go.mod`'s directive, not your dependencies'.

**Q7.** I see a `// indirect` module I have never heard of. Should I delete it?

A. No. Use `go mod why -m <module>` to see why it is there. It is recorded because something in your build needs it. `tidy` manages this block.

**Q8.** Does pruning affect `go.sum`?

A. Not directly. `go.sum` records hashes of modules in your build; pruning changes graph loading, not which modules are hashed. Both files are maintained by `tidy`.

**Q9.** Why was `go.mod` so small in old Go projects?

A. Because the full graph was loaded at build time to find indirect deps, so they did not all need to be recorded in `go.mod`. Pruning records them up front instead.

**Q10.** Is pruning the same as vendoring?

A. No. Vendoring copies dependency *source* into `vendor/`. Pruning is about how much of the module *graph* Go loads. They are independent (and they cooperate fine). See [03-go-mod-vendor](../03-go-mod-vendor/junior.md).

---

## Cheat Sheet

```bash
# Is this module pruned? Check the go directive:
go mod edit -json | grep -A1 '"Go"'      # go >= 1.17 means pruned

# Enable pruning (modern directive) and refresh go.mod:
go mod edit -go=1.21
go mod tidy

# See the (pruned) module graph:
go mod graph
go mod graph | wc -l                     # edge count

# Why is an indirect dependency here?
go mod why -m github.com/some/dep

# Keep go.mod self-contained after a dependency change:
go get example.com/foo@v1.5.0
go mod tidy

# CI gate: fail if go.mod/go.sum are not tidy
go mod tidy
git diff --exit-code go.mod go.sum

# See the selected versions (unchanged by pruning):
go list -m all
```

```
A pruned go.mod looks like:

    module example.com/app

    go 1.23                              ← the switch: >= 1.17 = pruned

    require (                            ← direct: what YOU import
        github.com/spf13/cobra v1.8.0
        github.com/google/uuid v1.6.0
    )

    require (                            ← indirect: recorded for self-containment
        github.com/inconshreveable/mousetrap v1.1.0 // indirect
        github.com/spf13/pflag v1.0.5 // indirect
    )
```

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `go.mod` grew a lot after a directive bump | Crossed into pruning (1.17+) | Expected; commit it |
| "updates to go.mod needed" | Stale indirect block | `go mod tidy` |
| Strange `// indirect` module | A dep requires it | `go mod why -m <mod>` |
| Huge `go mod graph` | Old `go 1.16` directive (full graph) | Bump directive, tidy |
| `go.mod` keeps changing on tidy | Toolchain or dep version drift | Pin toolchain; tidy once |

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain in one sentence what the module graph is
- [ ] Explain what module graph pruning removes and why
- [ ] Name the `go.mod` line that turns pruning on
- [ ] Explain why a pruned `go.mod` records more `// indirect` dependencies
- [ ] Read a two-block `go.mod` and say which deps are direct vs indirect
- [ ] State that pruning changes loading, not version selection
- [ ] Run `go mod tidy` and explain what it does to the indirect block
- [ ] Use `go mod why -m` to justify an indirect dependency
- [ ] Explain the difference between graph pruning and `go mod tidy`
- [ ] Decide that you should *not* hand-edit the indirect block

---

## Summary

Module graph pruning, introduced in Go 1.17, shrinks the part of the module graph that the `go` command must load. For a main module whose `go` directive is `1.17` or higher, Go loads the `go.mod` files of directly relevant dependencies and prunes away the deep, irrelevant rest — making `go` commands faster and the graph easier to reason about.

The visible cost is a bigger `go.mod`: to stay self-contained without loading the deep graph, a pruned module records more `// indirect` requirements, conventionally split into a second `require` block by `go mod tidy`. Pruning changes *how much of the graph Go loads*, not *which versions it selects* — your build is the same, just computed faster.

You opt in through the `go` directive (and `go mod init` already writes a modern one). Run `go mod tidy` after every dependency change, let it manage the indirect block, never hand-prune it, and verify tidiness in CI. The result is fast, reproducible, self-contained module metadata that you mostly never have to think about.

---

## What You Can Build

After learning this:

- **A fast-building service** whose every `go` command starts quickly thanks to a pruned graph.
- **A clean, self-contained `go.mod`** that reviewers can read to see exactly what you depend on.
- **A CI tidiness gate** that fails when someone forgets `go mod tidy`.
- **A correct directive-bump commit** that migrates an old module to pruning without breaking the build.

You cannot yet:
- Reason about the *full vs pruned* graph mechanics in detail (next: middle.md)
- Use `go mod tidy -go` and `-compat` to support multiple Go versions (middle.md)
- Handle deepening-the-graph edge cases and MVS interaction (senior.md)
- Read the pruning algorithm in the toolchain source (professional.md)

---

## Further Reading

- [Go Modules Reference — Module graph pruning](https://go.dev/ref/mod#graph-pruning) — official, authoritative.
- [Go 1.17 lazy module loading design document](https://go.googlesource.com/proposal/+/master/design/36460-lazy-module-loading.md) — the design behind pruning and lazy loading.
- [Go 1.17 Release Notes — Module graph pruning](https://go.dev/doc/go1.17#go-command) — the version that introduced it.
- [`go help mod tidy`](https://pkg.go.dev/cmd/go#hdr-Add_missing_and_remove_unused_modules) — the command that maintains the indirect block.
- [Managing dependencies](https://go.dev/doc/modules/managing-dependencies) — practical module workflow.

---

## Related Topics

- [6.1.1 `go mod init`](../01-go-mod-init/junior.md) — start a module (writes the `go` directive)
- [6.1.2 `go mod tidy`](../02-go-mod-tidy/junior.md) — maintains the direct/indirect requirements
- [6.1.3 `go mod vendor`](../03-go-mod-vendor/junior.md) — copy dependency source into `vendor/`
- [6.1.4 Minimal Version Selection (MVS)](../04-minimal-version-selection-mvs/junior.md) — selects versions from the (pruned) graph
- 11.1.5 `go mod` — full subcommand reference

---

## Diagrams & Visual Aids

```
Full graph (go 1.16) vs pruned graph (go 1.17+):

   FULL (load everything)           PRUNED (load relevant part)
   ----------------------           ---------------------------
   you                              you
    └─ A                             └─ A          (direct)
        └─ B                             └─ B      (needed: loaded)
            └─ D                         └─ C      (needed: loaded)
        └─ C                         [deep deps of B/C that you
            └─ E                      never reach are PRUNED]
                └─ F
                    └─ ...           go.mod records the few
   (all loaded, every command)      indirect deps needed → fast
```

```
Why go.mod grows under pruning:

   go 1.16 (full graph)              go 1.17+ (pruned graph)
   --------------------              -----------------------
   require (                         require (
       A v1.0.0                          A v1.0.0           ← direct
   )                                 )
   // few indirect lines;            require (
   // deep graph filled              B v1.2.0 // indirect   ← recorded for
   // them at load time              C v0.9.0 // indirect      self-containment
                                         ... more ...
                                     )
```

```
The go directive as a switch:

    go 1.17  or higher  ──►  PRUNED graph   (fast, bigger go.mod)
    go 1.16  or lower   ──►  FULL graph     (slow, smaller go.mod)

    Flip it:  go mod edit -go=1.21  &&  go mod tidy
```

```
Pruning vs version selection (they are separate):

    [module graph]
          │
          │  pruning trims what is LOADED  (this topic)
          ▼
    [smaller graph]
          │
          │  MVS picks one version per module  (unchanged)
          ▼
    [build list]  ← same versions as the unpruned build would pick
```
