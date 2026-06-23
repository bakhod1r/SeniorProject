# Workspaces — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros--cons)
8. [Use Cases](#use-cases)
9. [The Problem Workspaces Solve](#the-problem-workspaces-solve)
10. [Your First Workspace — Step by Step](#your-first-workspace--step-by-step)
11. [The Five `go work` Subcommands](#the-five-go-work-subcommands)
12. [Anatomy of a `go.work` File](#anatomy-of-a-gowork-file)
13. [Coding Patterns](#coding-patterns)
14. [Clean Setup](#clean-setup)
15. [Should I Commit `go.work`?](#should-i-commit-gowork)
16. [Workspaces and `go.sum`](#workspaces-and-gosum)
17. [Common Errors](#common-errors)
18. [Best Practices](#best-practices)
19. [Edge Cases & Pitfalls](#edge-cases--pitfalls)
20. [Common Mistakes](#common-mistakes)
21. [Tricky Points](#tricky-points)
22. [Test](#test)
23. [Tricky Questions](#tricky-questions)
24. [Cheat Sheet](#cheat-sheet)
25. [Self-Assessment Checklist](#self-assessment-checklist)
26. [Summary](#summary)
27. [What You Can Build](#what-you-can-build)
28. [Further Reading](#further-reading)
29. [Related Topics](#related-topics)

---

## Introduction

> Focus: "What is a `go.work` file?" and "How do I use one?"

You have learned to make a Go module: a folder with a `go.mod`. You have probably even imported a package from another module by running `go get`. Now imagine you are working on **two** modules at once — say, a small library you are building and the application that uses it. You change the library; the application should pick up the change instantly. How do you wire that up without publishing a new release of the library every five minutes?

That is the problem `go.work` solves. It is a tiny file, written next to (or above) your modules, that says:

> "When the `go` command builds anything in this directory tree, treat these listed modules as if they were one project. Use the local copy of each, not whatever version is in `go.mod`."

This file was added in **Go 1.18** as a first-class feature called **workspaces**. Before that, the only way to get the same behaviour was to litter every `go.mod` with `replace ../sibling` directives — and remember to delete them before pushing a release. Workspaces make that ugly step disappear.

After reading this you will:

- Know what `go.work` is and why Go added it
- Set up a workspace from scratch with two local modules
- Use `go work init`, `go work use`, `go work sync`, `go work edit`
- Understand when to commit `go.work` and when to gitignore it
- Recognise the basic error messages and fix them

You do **not** need to know about workspace internals, build cache interactions, or CI strategy yet. Those come in later levels.

---

## Prerequisites

- **Required:** Comfort writing a Go module — you have run `go mod init`, you can read a `go.mod`.
- **Required:** Go 1.18 or newer. Workspaces did not exist before that. (Use `go version` to check.)
- **Required:** You have imported at least one third-party package with `go get`.
- **Required:** Basic command-line skills — `cd`, `mkdir`, `tree` or `ls -R`.
- **Helpful:** You have at least once tried to "develop two modules at the same time" and been frustrated by it. The frustration is exactly the motivation for workspaces.

If `go version` reports anything earlier than `go1.18`, upgrade before continuing.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Module** | A folder containing a `go.mod` file and the source code under it. The unit of versioning in Go. |
| **Workspace** | A logical grouping of one or more modules controlled by a `go.work` file. Introduced in Go 1.18. |
| **`go.work`** | The file that defines a workspace. Lists modules and (optionally) replace directives. |
| **`go.work.sum`** | A companion lockfile for the workspace. Records hashes of dependencies that exist *outside* the listed modules. |
| **`use` directive** | A line in `go.work` that lists a module folder. Each `use` makes that module part of the workspace. |
| **`replace` directive** | A line that swaps one module path or version for another. Works the same in `go.work` as in `go.mod`. |
| **Workspace mode** | The state the `go` command enters when it finds a `go.work` file. Build commands consult the workspace, not just the current `go.mod`. |
| **Module mode** | The "normal" state, where only the local `go.mod` decides what is visible. The opposite of workspace mode. |
| **`GOWORK`** | An environment variable that overrides which `go.work` file (if any) is used. `GOWORK=off` disables workspace mode. |
| **`go work` subcommand** | A family of commands (`init`, `use`, `sync`, `edit`, `vendor`) that maintain `go.work`. Mirrors `go mod`. |

---

## Core Concepts

### Concept 1 — A workspace is a list of modules

A workspace is just a list of module folders, written in a `go.work` file:

```
go 1.22

use (
    ./api
    ./shared
)
```

That's it. Two modules — `./api` and `./shared` — are now part of the same workspace. When you build code in either folder, the `go` command treats both as **local source** rather than fetching them from the network.

### Concept 2 — A `go.work` file *overrides* `go.mod` `require` lines for listed modules

Suppose `./api`'s `go.mod` says:

```
require example.com/shared v1.2.0
```

Without a workspace, `go build` downloads `example.com/shared v1.2.0` from the proxy. **With** a workspace whose `go.work` lists `./shared` as a `use` entry, the `go` command silently substitutes the local `./shared` folder for that requirement. No network call, no version check — your live edits are used.

This is the magic, and the whole point of workspaces.

### Concept 3 — A workspace is found by walking up the directory tree

When you run `go build` (or any `go` command) inside a directory, the toolchain walks **up** until it finds either a `go.work` or a `go.mod`. If it finds `go.work` first (or before going outside any module), workspace mode is on. The `go.work` does not need to be in the current directory — it can be anywhere on the path up to the filesystem root.

You can also force a specific `go.work` with `GOWORK=/path/to/go.work`, or disable workspaces entirely with `GOWORK=off`.

### Concept 4 — Workspaces are local-only

A `go.work` file is **never** uploaded to the module proxy. It is not part of any published module. It is purely a developer-side, machine-side tool for *editing* multiple modules together. When someone consumes your library from outside the workspace, the `go.work` is irrelevant; only the published `go.mod` and tags matter.

This is why `go.work` is often added to `.gitignore`. (We will cover when *not* to gitignore it later.)

### Concept 5 — There is also `go.work.sum`

If your workspace pulls in dependencies that none of the listed modules' `go.sum` files cover, those checksums end up in a `go.work.sum` file next to `go.work`. This is rare on small workspaces and common on large ones. The rule of thumb: if you commit `go.work`, also commit `go.work.sum`. If you gitignore `go.work`, gitignore `go.work.sum` too.

---

## Real-World Analogies

**1. A shared shelf.** Each Go module is a book on its own shelf. Without a workspace, when book A wants to quote book B, it has to check out a *published edition* of B. A workspace is a shared bench where you place the live drafts of A and B side by side — A reads the draft of B directly, no checkout required.

**2. A monorepo's `package.json` workspaces.** If you have used npm or Yarn workspaces, Go workspaces are the equivalent: a top-level file pointing at sub-packages, so they resolve each other locally instead of through the registry. The mechanism is different, the goal is the same.

**3. Symlinking modules into `node_modules`.** In some package managers you can `npm link` a local package into another. That is hacky and easy to forget. `go.work` is a declarative version of the same idea — written in a file, versioned (or not), and easy to undo.

**4. Editor "open folder."** When you open a folder in VS Code, every file in it is "in scope" for navigation. Workspaces do the same for the Go toolchain: every listed module is in scope, and cross-module imports resolve directly.

---

## Mental Models

### Model 1 — `go.work` is a routing table for the build

Without a workspace, every import `example.com/foo` is resolved through `go.mod` and the module cache. With a workspace, `go.work` is consulted first: "Is `example.com/foo` listed here as a `use` directive (or replaced)? If yes, use the local folder. If no, fall through to the cache."

### Model 2 — `go.mod` is the contract; `go.work` is the rehearsal

`go.mod` lists what your module will need *in production*. `go.work` lists what is convenient *while you develop locally*. Production consumers never see `go.work`; they only see your published `go.mod`. So the workspace is, structurally, a rehearsal stage — you can swap in local copies of dependencies, try things, and never accidentally ship the swap.

### Model 3 — The toolchain walks up; it does not walk down

When you `cd ./api && go build`, the `go` command does not scan its siblings. It walks **upwards** from `./api` until it finds either a `go.work` or a `go.mod`. If `go.work` is at the parent directory and lists `./api` and `./shared`, both are in scope. If you `cd` into `./api`'s parent's parent, no `go.work` is visible, and the build is in plain module mode.

### Model 4 — A `use` line is *additive*; a `replace` line is *substitutive*

`use ./shared` adds the module at `./shared` to the workspace. After that, any other listed module that depends on `example.com/shared` will resolve to the local copy instead.

`replace example.com/shared => ./shared` does almost the same thing — but it uses the older `replace` mechanism. In a workspace, you almost always want `use`. `replace` is for stranger swaps (e.g., redirecting a dependency to a fork's URL).

---

## Pros & Cons

| Pros | Cons |
|------|------|
| Edit two modules together without `replace` in `go.mod` | Only Go 1.18+; older toolchains do not understand it |
| `go.work` is local-only — no risk of accidentally shipping a `replace` | Yet another file to remember to gitignore (or commit) |
| `go work` subcommands keep the file tidy automatically | Easy to forget to add a *new* sub-module to `go.work` |
| Works seamlessly with editors and `gopls` | If `go.work` is committed, every contributor must keep their copy in sync |
| Disables itself with `GOWORK=off` for clean release builds | Some CI configurations need explicit `GOWORK=off` to avoid surprises |

### When to use:

- You are developing a library and a consumer of that library at the same time.
- You have a monorepo with two or more modules that import each other.
- You temporarily need to test an unreleased feature in a sibling module.

### When NOT to use:

- You only have one module — workspaces are pointless.
- You are about to publish a release: temporarily disable the workspace (`GOWORK=off`) so the build matches what consumers will see.
- You want stable, reproducible CI builds — see senior.md for the trade-offs there.

---

## Use Cases

- **Library + consumer in one repo.** You maintain a logging library and the API server that uses it. Both live as separate modules; the workspace lets you edit both at once.
- **Microservice monorepo.** Half a dozen services share two or three internal libraries. A single `go.work` at the repo root lists every module.
- **Examples folder for an open-source library.** Your library's `examples/` directory is its own module so users can copy-paste it. A `go.work` at the root lets you run those examples against your live library code.
- **Forking a third-party module.** Clone the upstream into a sibling folder, list it in `go.work`, and your fixes are picked up immediately by every dependent in the workspace.
- **Experimenting with breaking changes.** You are about to bump a library to v2. Use a workspace to validate every consumer compiles before you tag the release.

---

## The Problem Workspaces Solve

To appreciate `go.work`, look at the world before it. You have two modules:

```
~/work/
├── api/
│   ├── go.mod        # module example.com/api
│   └── main.go       # imports example.com/shared
└── shared/
    ├── go.mod        # module example.com/shared
    └── shared.go
```

The `api` module says `require example.com/shared v1.2.0` in its `go.mod`. You are developing both at once. Three painful options were available before Go 1.18:

**Option A — Publish on every change.** Edit `shared`, `git commit`, `git push`, `git tag v1.2.1`, run `go get example.com/shared@v1.2.1` in `api`. Slow, polluting, and impossible without push access.

**Option B — Add a `replace` to `api/go.mod`.**

```
require example.com/shared v1.2.0
replace example.com/shared => ../shared
```

Works. But:

- You must remember to delete the `replace` before tagging a release of `api`. If you forget, your published `go.mod` says "use the directory `../shared`" — and that path does not exist on a stranger's machine. Their build breaks.
- Every contributor has to have `shared` checked out at exactly `../shared`. Different layouts break the build.
- Reviewers often miss the `replace` line in PRs.

**Option C — Vendoring.** Copy `shared` into `api/vendor/`, edit there. Now you have two diverging copies. No.

Workspaces eliminate all three:

```
~/work/
├── go.work            # NEW — lists ./api and ./shared
├── api/
│   ├── go.mod
│   └── main.go
└── shared/
    ├── go.mod
    └── shared.go
```

`api/go.mod` keeps its honest `require example.com/shared v1.2.0` line. The `go.work` at the parent level says "use the local folders." When you build in `api/`, the toolchain finds `go.work`, sees `shared` listed, and uses the local copy. No `replace` in any `go.mod`. No risk of shipping the swap.

---

## Your First Workspace — Step by Step

Let's build the directory above from scratch.

### Step 1 — Create the parent and the two modules

```bash
mkdir -p ~/work && cd ~/work

mkdir api && cd api
go mod init example.com/api
cd ..

mkdir shared && cd shared
go mod init example.com/shared
cd ..
```

So far this is two unrelated modules. Verify:

```bash
tree -L 2
# .
# ├── api
# │   └── go.mod
# └── shared
#     └── go.mod
```

### Step 2 — Write a tiny library and a tiny consumer

`shared/greet.go`:

```go
package shared

func Greet(name string) string {
    return "Hello, " + name + "!"
}
```

`api/main.go`:

```go
package main

import (
    "fmt"

    "example.com/shared"
)

func main() {
    fmt.Println(shared.Greet("world"))
}
```

If you `cd api && go build` now, it fails:

```
api/main.go:6:5: no required module provides package example.com/shared;
to add it: go get example.com/shared
```

That is correct. `api`'s `go.mod` does not require `shared`, and even if it did, `shared` is not published anywhere.

### Step 3 — Initialise the workspace

From `~/work`:

```bash
go work init ./api ./shared
```

You now have a `go.work` at the root:

```
go 1.22

use (
    ./api
    ./shared
)
```

(Your `go` line will show whatever toolchain you have.)

### Step 4 — Build again

```bash
cd ~/work/api
go build
./api
# Hello, world!
```

It works. `api` did not need a `go get` for `shared`, did not need a `replace` line — the workspace took care of everything.

### Step 5 — Edit `shared`, see the change in `api`

Open `shared/greet.go`:

```go
package shared

func Greet(name string) string {
    return "Hi there, " + name + "!"   // changed
}
```

Re-run:

```bash
cd ~/work/api
go run .
# Hi there, world!
```

No publish, no version bump, no `replace`. That is the workspace value proposition.

### Step 6 — Disable the workspace, see the difference

```bash
cd ~/work/api
GOWORK=off go build
# api/main.go:6:5: no required module provides package example.com/shared
```

Without the workspace, the build is back to its honest, "I need a published version" state. `GOWORK=off` is your friend for verifying release-quality builds.

---

## The Five `go work` Subcommands

You will rarely edit `go.work` by hand. The `go work` subcommands keep it tidy:

| Subcommand | What it does |
|------------|--------------|
| `go work init [path...]` | Creates a `go.work` listing the given module folders. |
| `go work use [path...]` | Adds the given folders to an existing `go.work`. With `-r`, recursively finds all sub-modules. |
| `go work edit -...` | Programmatically edits `go.work` (add/drop `use`, `replace`, `go` directive). |
| `go work sync` | Pushes the workspace's resolved versions back into each module's `go.mod`. |
| `go work vendor` | Creates a `vendor/` directory at the workspace level. (Go 1.22+.) |

There is no `go work tidy` — `go.work` does not get out of date the way `go.mod` does. Add and remove `use` lines as your modules come and go.

### `go work init`

```bash
go work init ./api ./shared
```

Creates `go.work`. Lists each given folder under `use`. Picks the highest `go` directive of all listed modules. If you pass no arguments, it creates an empty workspace (legal but useless until you `go work use`).

### `go work use`

```bash
# Add a single new module
go work use ./billing

# Add every Go module under the current directory
go work use -r .

# Remove a use entry
go work use -r=false ./billing      # Wrong — this is not how you remove
# Correct:
go work edit -dropuse=./billing
```

### `go work edit`

A scriptable, sed-free way to edit `go.work`:

```bash
go work edit -use ./newmod
go work edit -dropuse ./oldmod
go work edit -replace example.com/lib=../my-fork
go work edit -dropreplace example.com/lib
go work edit -go=1.22
```

Each flag corresponds to a directive in the file. The toolchain rewrites `go.work` cleanly after each invocation.

### `go work sync`

If you upgrade a dependency in one module, `go work sync` propagates the chosen version to every other module's `go.mod`. We dig into this in middle.md.

### `go work vendor` (Go 1.22+)

Builds a workspace-wide `vendor/` directory containing every dependency. Less commonly used at the junior stage; included here for completeness.

---

## Anatomy of a `go.work` File

Here is a fuller example:

```
go 1.22

toolchain go1.22.4

use (
    ./api
    ./shared
    ./internal/utils
)

replace example.com/external => github.com/me/external-fork v0.5.0
```

Line by line:

- `go 1.22` — the minimum Go directive for the workspace. Cannot be lower than any listed module's `go` line.
- `toolchain go1.22.4` (Go 1.21+) — pin the workspace's toolchain version. Optional.
- `use ( ... )` — the heart of the file. Each path is a folder containing a `go.mod`.
- `replace ...` — same syntax and semantics as a `replace` in `go.mod`, but applies workspace-wide. A workspace `replace` *overrides* any `replace` in the listed modules' `go.mod` files.

The format is permissive about whitespace. A single-line `use ./path` works, as does a parenthesised block. The toolchain will format it consistently when you use `go work edit`.

---

## Coding Patterns

### Pattern 1 — Library + consumer in two folders

**Intent:** Develop a library and an application that uses it together.

```
project/
├── go.work
├── lib/
│   ├── go.mod          # module example.com/lib
│   └── lib.go
└── app/
    ├── go.mod          # module example.com/app, requires example.com/lib
    └── main.go
```

`go.work`:

```
go 1.22

use (
    ./lib
    ./app
)
```

Build/run from the project root or from `./app` — both work. The toolchain follows the upward search.

### Pattern 2 — One module, examples folder

**Intent:** Your library has runnable examples, but `examples/` should not pollute the library's dependency graph.

```
mylib/
├── go.work
├── go.mod              # module example.com/mylib
├── mylib.go
└── examples/
    ├── go.mod          # module example.com/mylib/examples (separate!)
    └── basic/main.go
```

`go.work`:

```
go 1.22

use (
    .
    ./examples
)
```

The two `go.mod` files keep `examples`'s ad-hoc dependencies out of `mylib`'s graph. The workspace lets the example code import `mylib` from the parent folder live.

---

## Clean Setup

### Use `go work init` and `go work use` — do not hand-roll the file

It is tempting to type `go.work` by hand. Don't. The subcommands give you forward-compatible formatting and pick a sensible `go` directive automatically.

```bash
# Good
go work init ./api ./shared

# Hand-rolled (works, but easy to get wrong)
cat > go.work <<EOF
go 1.22
use (
    ./api
    ./shared
)
EOF
```

### Place `go.work` at the natural root

Put it at the smallest folder that contains *all* the modules you want grouped. Usually this is a project root, repo root, or monorepo top.

### Keep paths relative

The `use` directive accepts both relative and absolute paths. Use relative — they are portable across machines.

```
use (
    ./api
    ./shared
)
```

Not:

```
use (
    /Users/alice/work/api      # only works on Alice's laptop
)
```

### One workspace per concept, not per repo

If a repo holds two unrelated module trees, give them two `go.work` files in two subdirectories rather than one giant workspace at the root.

---

## Should I Commit `go.work`?

A short answer with a longer one underneath.

**Short answer.** It depends on whether everyone on the project edits the same set of modules in the same layout.

**Long answer.**

| Situation | Commit? |
|-----------|---------|
| Solo project, single dev machine | **Don't commit.** Add `go.work` to `.gitignore`. |
| Open source library with one published module + examples | **Commit it.** External contributors need the workspace to run examples. |
| Monorepo where everyone touches the same modules in the same layout | **Commit it.** Saves every contributor 30 seconds and one mistake. |
| Multi-repo project where each dev has a unique layout | **Don't commit.** Each dev writes their own. |

If you commit `go.work`, you must also commit `go.work.sum` (when it exists). If you gitignore `go.work`, gitignore `go.work.sum` too.

A common pattern in open-source Go projects: gitignore `go.work` and `go.work.sum`, but provide a `go.work.example` or a Makefile target that creates one for new contributors.

---

## Workspaces and `go.sum`

A common confusion: "Does the workspace edit my `go.sum`?" No. Each module keeps its own `go.sum`. The workspace simply tells the toolchain "skip the require, use the local folder."

The exception is `go.work.sum`. If your workspace ends up with dependencies not covered by any individual module's `go.sum`, those land in `go.work.sum`. This is most common when the workspace adds a `replace` directive that pulls in new transitive dependencies. For a simple monorepo without workspace-level `replace`, you may never see a `go.work.sum`.

Either way, do not edit these files by hand. The toolchain manages them.

---

## Common Errors

### Error 1 — "directory ... is not a module"

```
$ go work use ./shared
go: directory shared is not a module: missing go.mod
```

**Why:** `go work use` requires that the path already contains a `go.mod`.
**Fix:**

```bash
cd shared && go mod init example.com/shared && cd ..
go work use ./shared
```

### Error 2 — "no required module provides package ..."

```
$ go run ./api
api/main.go:5:8: no required module provides package example.com/shared
```

**Why:** Either there is no `go.work`, or `./shared` is not in the `use` list.
**Fix:**

```bash
go work use ./shared          # creates go.work or extends it
```

### Error 3 — "duplicate use directive"

```
go: go.work:5: duplicate use directive ./shared
```

**Why:** You ran `go work use ./shared` twice, or hand-edited the file and added the same path.
**Fix:** Remove the duplicate line from `go.work`. Or:

```bash
go work edit -dropuse=./shared
go work use ./shared
```

### Error 4 — "go.work file requires go 1.X"

```
go: go.work file requires go 1.22 but go is 1.20
```

**Why:** The `go` directive in `go.work` is higher than the toolchain you are running.
**Fix:** Upgrade Go, or lower the `go` directive (`go work edit -go=1.20`) — but only if every listed module also supports that version.

### Error 5 — Forgetting to disable the workspace before release

You publish `api`. Consumers complain: "I get `example.com/shared v1.2.0` from the proxy, but you developed against your local copy and the API does not match."

**Why:** Your local builds were resolving `shared` to the local folder, which had unpublished changes. Your `go.mod` still says `v1.2.0`, but that version on the proxy lacks your changes.

**Fix:** Before tagging, run with `GOWORK=off` to verify the build still works against the published versions, then publish a new `shared` tag and bump `api`'s `require`.

---

## Best Practices

- **Always run `GOWORK=off go build ./...` before tagging a release.** It catches the "I forgot to publish `shared`" mistake.
- **Add `go.work*` to `.gitignore` by default.** Commit only when there is a clear reason.
- **Keep `go.work` flat.** Nested workspaces are legal but confuse newcomers. One workspace, one root.
- **Use `go work init` and `go work use -r .` to bootstrap.** Less error-prone than hand-typing.
- **Never leave a stale `replace` in `go.work`.** They are easy to forget. Use `go work edit -dropreplace ...` when done.
- **Document the workspace.** A short `README` line — "run `go work init` after cloning" — saves contributors hours.

---

## Edge Cases & Pitfalls

### A new sub-module is not auto-added

If you create `./billing/` with its own `go.mod` and another listed module imports it, you still need:

```bash
go work use ./billing
```

Otherwise, `billing` is invisible to the workspace and the consumer falls back to the proxy.

### Workspace + `vendor/` interaction

If a listed module has a `vendor/` directory and the workspace is active, the toolchain ignores the `vendor/` for that module by default. If you specifically want vendored builds, run `go work vendor` (Go 1.22+) for a workspace-wide vendor tree, or `GOWORK=off go build -mod=vendor`.

### `go.work` in a nested directory hides outer `go.work`

If you put `go.work` in `~/work/inner/` and run a build from `~/work/inner/api/`, only the inner workspace applies. The outer `~/work/go.work` is ignored. The toolchain stops at the first `go.work` it finds.

### Replace in module's `go.mod` is overridden by workspace

If `api/go.mod` has `replace example.com/lib => ../my-fork` and `go.work` lists both `./api` and `./lib`, the workspace's `use ./lib` wins. The `replace` in `api/go.mod` is silently inactive while the workspace is on.

### Cross-platform path separators

Always use forward slashes in `go.work`, even on Windows: `./api` not `.\api`. The toolchain normalises but consistency keeps diffs clean.

---

## Common Mistakes

1. **Treating `go.work` like `go.mod`.** It is not. `go.work` does not have `require`. It has `use`.
2. **Adding `go.work` to a published module's git tree without thinking.** External users may not appreciate inheriting your local layout.
3. **Forgetting that `GOWORK=off` is needed for honest release builds.**
4. **Confusing `go work sync` with `go mod tidy`.** `tidy` cleans a single `go.mod`. `sync` aligns versions across the workspace's modules.
5. **Listing the same module under both `use` and `replace`.** The workspace becomes confused; the toolchain may pick either.
6. **Editing `go.work` by hand and forgetting the `go` directive line.** The file becomes invalid.
7. **Putting `go.work` *inside* a module folder.** It works, but the search semantics are surprising. Place it above any listed module.

---

## Tricky Points

- **`go.work` does not affect tests of unlisted dependencies.** If a transitive dep imports your local module via the workspace, fine. If it imports a *different* version of one of your modules, the workspace still wins because workspace mode replaces every reference to the module path, not only direct ones.
- **`go work use ./.`** is invalid syntax for "the current directory." Use `go work use .` (single dot).
- **`go work init` overwrites an existing `go.work` without prompting.** Be careful.
- **Workspaces and `go install ./cmd/...`.** Inside a workspace, `go install` builds the local code, including any local versions of dependencies. The installed binary may differ from one built outside the workspace.
- **The `go` directive in `go.work` does not "lower" any `go.mod`.** A module's `go.mod` may still require a higher `go` line; the workspace's `go` directive sets a *floor*, not a ceiling.

---

## Test

Try these on a fresh workspace and verify your understanding.

1. Create three modules under one folder: `web/`, `core/`, `db/`. Initialise a workspace with all three. Print `go.work`.
2. From `web/`, run a program that imports a function from `core` and one from `db`. Verify it builds.
3. Run the same build with `GOWORK=off` and predict the outcome before pressing enter.
4. Drop `db` from the workspace using `go work edit`. Verify the build now fails.
5. Re-add `db` with `go work use ./db`. Verify it succeeds.

---

## Tricky Questions

**Q.** *I commit `go.work` and a contributor on a different OS gets "directory ./api is not a module." What happened?*
**A.** They probably cloned into a path with different casing or layout, or they did not clone every sub-module the workspace lists. Workspaces assume the on-disk layout matches the `use` paths exactly.

**Q.** *Does `go.work` affect what gets published when I `go release`?*
**A.** No. Publication looks at tags and `go.mod` only. `go.work` is invisible to the proxy and to consumers.

**Q.** *Why does my CI sometimes pick up local edits I did not push?*
**A.** Usually because `go.work` is committed and the CI's checked-out copy is the one with your unintended `replace` line. Either gitignore `go.work` or use `GOWORK=off` in the CI step.

**Q.** *Can I use a workspace with no `go.mod` files at all?*
**A.** No. A workspace lists modules; modules need `go.mod`. Empty folders cannot be `use`d.

**Q.** *What's the difference between `replace` in `go.work` and `replace` in `go.mod`?*
**A.** Scope. A `replace` in `go.work` applies to every module in the workspace, even ones whose `go.mod` says nothing about that dependency. A `replace` in `go.mod` applies only to that one module — and gets shipped with releases.

---

## Cheat Sheet

```bash
# Bootstrap a workspace from two existing modules
go work init ./api ./shared

# Add another module
go work use ./billing

# Recursively add every module in the tree
go work use -r .

# Remove a module
go work edit -dropuse=./billing

# Replace a third-party module with a local fork
go work edit -replace=example.com/lib=../my-fork

# Sync versions back into each go.mod
go work sync

# Run a build as if the workspace did not exist
GOWORK=off go build ./...

# Find which go.work the toolchain is using
go env GOWORK
```

A minimal `go.work`:

```
go 1.22

use (
    ./api
    ./shared
)
```

---

## Self-Assessment Checklist

- [ ] You can explain in one sentence what `go.work` does.
- [ ] You can create a workspace with two modules from scratch using `go work init`.
- [ ] You know the difference between a `use` directive and a `replace` directive.
- [ ] You can list and remove modules with `go work edit`.
- [ ] You can disable the workspace temporarily with `GOWORK=off`.
- [ ] You know the difference between `go.work`, `go.work.sum`, and `go.sum`.
- [ ] You can decide whether to commit `go.work` for a given project.
- [ ] You can recognise the most common workspace error messages.

---

## Summary

A `go.work` file lists Go modules, and while it exists the `go` toolchain treats those modules as a single workspace: cross-module imports resolve to local folders rather than to versioned downloads. This eliminates the old habit of sprinkling `replace ../sibling` directives across every `go.mod` and forgetting to remove them before release. The five `go work` subcommands — `init`, `use`, `sync`, `edit`, `vendor` — manage the file without hand-editing. Whether you commit `go.work` depends on whether your team's on-disk layout is consistent enough to share. Always run with `GOWORK=off` before publishing, to verify the build still works against the *published* versions of your dependencies.

---

## What You Can Build

- A two-module project where a CLI imports a library you write — both edited live.
- A monorepo skeleton with three or four sibling modules and a single `go.work` at the top.
- A Makefile target `make release-check` that runs `GOWORK=off go build ./...` before any `git tag`.
- A library with a runnable `examples/` sub-module wired through `go.work`.

---

## Further Reading

- The `go work` help text is the most concise reference. Run `go help work` and read each subcommand's `go help work init`, `go help work use`, etc.
- The Go modules reference covers the workspace file syntax in detail.
- The Go 1.18 release notes describe the original motivation for workspaces.

---

## Related Topics

- **Modules and `go.mod`** — the foundation; workspaces sit on top.
- **`replace` directives** — the predecessor that workspaces largely retire.
- **Vendoring** — an alternative for reproducible builds, sometimes combined with workspaces.
- **CI/CD** — workspaces interact with CI in non-obvious ways; see senior.md.
