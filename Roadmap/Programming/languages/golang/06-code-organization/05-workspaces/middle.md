# Workspaces — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [Workflow: Library + Consumer Together](#workflow-library--consumer-together)
3. [`go work sync` Explained](#go-work-sync-explained)
4. [Bumping a Dependency Across the Workspace](#bumping-a-dependency-across-the-workspace)
5. [Replace Directives — Workspace vs Module](#replace-directives--workspace-vs-module)
6. [Adding a New Module to an Existing Workspace](#adding-a-new-module-to-an-existing-workspace)
7. [Removing a Module Cleanly](#removing-a-module-cleanly)
8. [The Release-Day Routine](#the-release-day-routine)
9. [Commit `go.work` or Gitignore It?](#commit-gowork-or-gitignore-it)
10. [`go.work.sum` Demystified](#goworksum-demystified)
11. [Workspaces and Tooling: gopls, golangci-lint, GoLand](#workspaces-and-tooling-gopls-golangci-lint-goland)
12. [Inter-Module Tests](#inter-module-tests)
13. [Mock-and-Replace Workflows for Forks](#mock-and-replace-workflows-for-forks)
14. [Workspaces and `go mod tidy`](#workspaces-and-go-mod-tidy)
15. [Migration: From `replace ../sibling` to `go.work`](#migration-from-replace-sibling-to-gowork)
16. [Common Pitfalls at this Level](#common-pitfalls-at-this-level)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

At the junior level you learned to *create* a workspace. Middle level is about *living* with one: keeping the workspace tidy as modules come and go, syncing dependency versions across them, deciding when to commit the file, and reasoning about the strange interactions with `go mod tidy`, `gopls`, and your CI.

After reading this you will:

- Drive a real "library + app" workflow from feature branch to release tag
- Use `go work sync` correctly and know what it does *not* do
- Decide when a `replace` belongs in `go.work` vs in a module's `go.mod`
- Manage a `go.work.sum` file consciously instead of by accident
- Avoid the four or five gotchas that bite mid-level engineers most often

---

## Workflow: Library + Consumer Together

Imagine `~/proj/`:

```
proj/
├── go.work
├── server/             # module example.com/proj/server
│   ├── go.mod
│   └── main.go
└── auth/               # module example.com/proj/auth
    ├── go.mod
    └── token.go
```

`go.work`:

```
go 1.22

use (
    ./server
    ./auth
)
```

`server/go.mod` requires `example.com/proj/auth v0.3.0`. While the workspace is active, `auth`'s local source is what's compiled into `server`. You make a change in `auth/token.go` — `server` sees it on the next `go run`.

The mental shift from "two separate modules" to "one workspace" is small but powerful: you stop thinking about versions during development. Versions matter again only at release.

### A typical day

1. **Pull and update.** `git pull` at the workspace root. If teammates added a new module, run `go work use ./new-module` to register it in your local `go.work` (assuming `go.work` is gitignored). If the workspace file is committed, `git pull` already updated it.
2. **Edit.** Change `auth/token.go` and `server/main.go` in the same branch.
3. **Test locally.** `go test ./...` from the workspace root runs every module's tests with the local versions.
4. **Verify the release boundary.** Before pushing, `GOWORK=off go build ./...` from each module to make sure each module *also* builds against the currently required published versions. If `server` cannot build with `auth v0.3.0`, you have a release ordering problem — see [The Release-Day Routine](#the-release-day-routine).
5. **Commit and push.** Each module gets its own tags as needed.

### Why `go test ./...` from the workspace root works

Inside a workspace, `./...` expands to "every package in every listed module." This is one of the quietly nice things about `go.work` — you do not need a Makefile loop over modules anymore.

```bash
cd ~/proj
go test ./...
ok      example.com/proj/server     0.123s
ok      example.com/proj/auth       0.045s
```

Without a workspace, you would `cd` into each module separately, or write a script.

---

## `go work sync` Explained

`go work sync` is one of the most misunderstood commands. It does **one** specific thing: it pushes the workspace's chosen dependency versions into each listed module's `go.mod`.

### Why this matters

Inside a workspace, the `go` toolchain runs Minimum Version Selection (MVS) over the *union* of every listed module's requirements. The result is a single resolved set of versions. Each individual `go.mod`, however, may still list older versions — because those `go.mod` files were tidied independently before the workspace existed.

Example. Two modules:

- `server/go.mod` requires `golang.org/x/text v0.10.0`.
- `auth/go.mod` requires `golang.org/x/text v0.14.0`.

When the workspace is active, MVS picks `v0.14.0` (the higher). Both modules compile against `v0.14.0`. But `server/go.mod` *still says* `v0.10.0`. If you publish `server` and a consumer pulls it without the workspace, they get `v0.10.0` — possibly missing API your code now uses.

`go work sync` fixes this:

```bash
go work sync
```

After running, both `go.mod` files list `golang.org/x/text v0.14.0`.

### What `go work sync` does NOT do

- It does not change `go.work` itself.
- It does not delete unused requires (that's `go mod tidy`).
- It does not pull new versions from the proxy — it only redistributes what is already chosen.
- It does not affect modules outside the workspace.

### When to run it

- Before tagging a release of any listed module.
- After a workspace-wide upgrade (`go get -u ./...` from the workspace root).
- Periodically (perhaps in CI) to detect drift.

A common CI check:

```yaml
- run: go work sync
- run: git diff --exit-code go.mod */go.mod
```

If any `go.mod` changes, the build fails — engineers must commit the synced versions.

---

## Bumping a Dependency Across the Workspace

The naive way: `cd` into every module, `go get -u dep@v1.5.0`, repeat. Tedious and error-prone.

The workspace way:

```bash
cd ~/proj                              # workspace root
go get -u golang.org/x/text@v0.14.0    # picks the highest needed
go work sync                           # propagate to every go.mod
go test ./...                          # verify
```

`go get` inside a workspace does something specific: it operates on **the module containing the working directory**. Since the workspace root is usually outside any single module, `go get` may pick the first listed module or refuse to act. The reliable pattern is:

```bash
cd ~/proj/server
go get -u golang.org/x/text@v0.14.0
cd ~/proj
go work sync
```

Or, since Go 1.22, `go get` has gained better workspace awareness — it walks the workspace and updates every module's requirements. Behaviour varies; `go work sync` afterwards remains a good habit.

---

## Replace Directives — Workspace vs Module

Both `go.work` and `go.mod` accept `replace` directives. They differ in **scope** and **lifetime**.

| Aspect | `replace` in `go.mod` | `replace` in `go.work` |
|--------|-----------------------|------------------------|
| Scope | One module | Entire workspace |
| Lifetime | Ships with releases | Local only |
| Use case | Permanent, declared substitution | Temporary, dev-only swap |
| Risk | High — easy to accidentally publish | Low — never published |

### When a `replace` belongs in `go.mod`

- You ship a fork of a third-party library and the substitution is permanent. (Rare; usually a better answer is to publish the fork under a new module path.)
- You need to point at a temporary patch and you intend to publish a release with that patch in place. (Even rarer; usually means you need a real fork.)

### When a `replace` belongs in `go.work`

- You temporarily swap one of your dependencies to a local clone for development.
- You are working on a fork and want every workspace module to see the fork.
- You are pinning a specific commit during a debugging session.

### The migration that almost everyone needs to do

Pre-1.18 codebases are full of `replace ../sibling` lines in `go.mod`. They served the same purpose as a workspace `use`. **Move them to `go.work`** and delete them from each `go.mod`:

```diff
 // server/go.mod
 module example.com/proj/server
 require example.com/proj/auth v0.3.0
-replace example.com/proj/auth => ../auth
```

```diff
 // go.work (new file at proj root)
+go 1.22
+use (
+    ./server
+    ./auth
+)
```

The published `server v0.3.1` no longer carries the dangerous `replace`, and any contributor who clones gets the same workspace behaviour.

---

## Adding a New Module to an Existing Workspace

Step by step. Suppose you want to add `./billing/`.

```bash
mkdir billing && cd billing
go mod init example.com/proj/billing
# write some code
cd ..
go work use ./billing
```

After `go work use`, `go.work` now includes `./billing`. If `server` decides to import `billing`, it works immediately.

If you have a deep tree of new modules:

```bash
go work use -r ./vendor-packages
# scans recursively, adds every directory containing a go.mod
```

The `-r` flag is convenient and slightly dangerous — it will pick up *every* sub-module, even ones you might not want in the workspace (e.g., `examples/` or `_test/`). Review the diff to `go.work` before committing.

---

## Removing a Module Cleanly

To remove `./billing`:

```bash
go work edit -dropuse=./billing
```

That removes the line from `go.work`. The module folder still exists; the workspace simply ignores it.

If you also want to delete the folder:

```bash
go work edit -dropuse=./billing
rm -rf billing
```

A common mistake: deleting the folder first, then trying to run a build. The toolchain complains about a missing `use` target. Always edit `go.work` first.

---

## The Release-Day Routine

Releasing a module that lives in a workspace requires a small checklist.

### 1. Verify the published versions still produce a working build

```bash
GOWORK=off go build ./...
GOWORK=off go test ./...
```

This is the single most important step. If your local builds use `auth`'s unreleased `v0.4.0-dev` features but `server/go.mod` still requires `v0.3.0`, the disabled-workspace build will fail — exactly what your consumers will see.

### 2. Sync versions

```bash
go work sync
git diff
```

If `go work sync` produced changes, commit them. Each `go.mod` should reflect the intended versions for the upcoming release.

### 3. Run `go mod tidy` in each module

```bash
for m in server auth billing; do (cd $m && go mod tidy); done
```

`go mod tidy` adds missing transitive requires and removes unused ones. The workspace cannot do this — it is per-module bookkeeping.

### 4. Tag in dependency order

If `server` depends on `auth`, tag `auth` first, push, and then bump `server/go.mod` to require the new tag:

```bash
cd auth
git tag auth/v0.4.0
git push origin auth/v0.4.0
cd ../server
go get example.com/proj/auth@v0.4.0
git tag server/v0.5.0
git push origin server/v0.5.0
```

(In a single-module repo, the tag is just `v0.4.0`; in a multi-module repo, the tag must be prefixed with the module subdirectory — `auth/v0.4.0`, `server/v0.5.0`. This is a Go modules rule, not a workspace one.)

### 5. Re-test with `GOWORK=off`

```bash
GOWORK=off go build ./...
```

After tagging, the published versions should still produce a working build. If not, you missed a sync somewhere.

---

## Commit `go.work` or Gitignore It?

The decision tree:

1. **Are all contributors on the same on-disk layout?** If no, gitignore.
2. **Is the workspace authoritative for the whole repo?** If yes, commit. (E.g., a monorepo with all modules under one root.)
3. **Do contributors sometimes work on only a subset of the modules?** If yes, gitignore so each contributor can write their own.
4. **Are there examples or tooling that need a workspace to run?** If yes, commit a `go.work.example` and document the bootstrap step.

A practical heuristic, used by many Go projects:

- **Commit** for monorepos and tightly coupled multi-module repos.
- **Gitignore** for libraries that are only used as workspaces during local development of forks or examples.

If you commit, also commit `go.work.sum`. If you gitignore, gitignore both.

A `.gitignore` snippet:

```
go.work
go.work.sum
```

A `go.work.example` for shared bootstrap:

```
go 1.22

use (
    ./api
    ./shared
)
```

with a README line:

```
cp go.work.example go.work    # then customise as needed
```

---

## `go.work.sum` Demystified

`go.work.sum` is the workspace's analogue of `go.sum`. It records hashes of dependencies that are not covered by any individual module's `go.sum`.

### When it appears

- The workspace adds a `replace` directive that pulls in new transitive dependencies.
- The workspace's MVS resolution picks a transitive version that no listed `go.mod` requires directly.
- Tooling (like `go run`) requires verifying a module the listed modules do not.

### When it does not appear

- A simple workspace whose listed modules already cover everything in their own `go.sum`.

### What to do with it

- **If you commit `go.work`, commit `go.work.sum`.** Both are needed for reproducible workspace builds.
- **Never edit it by hand.** It is integrity-checked. A single byte change kills the build.
- **If a merge conflict appears in `go.work.sum`,** accept either side and re-run `go mod tidy` in each listed module followed by `go work sync`. The toolchain regenerates a clean file.

---

## Workspaces and Tooling: gopls, golangci-lint, GoLand

Modern Go editors are workspace-aware out of the box.

### `gopls`

The Go language server picks up `go.work` automatically. Cross-module navigation, autocomplete, and "Go to definition" jump to the local source. If `gopls` seems confused, restart the editor — it caches the workspace layout at startup.

### `golangci-lint`

`golangci-lint run ./...` from the workspace root lints every listed module. Useful in CI. If your linter config has per-module exclusions, place a `.golangci.yaml` at each module root rather than at the workspace root.

### GoLand / IntelliJ

GoLand reads `go.work` and treats every listed module as a content root. Indexing is faster on workspaces because GoLand can share parsed AST between modules.

### `gotestsum`, `go-test-report`, etc.

All workspace-aware via the `./...` expansion at the workspace root.

### What still needs explicit setup

- **`pre-commit` hooks.** Each module's hook needs the right working directory; a workspace-level hook should iterate over modules.
- **Coverage reports.** `go test -cover ./...` works at the workspace level, but combined coverage across modules requires `go test -coverprofile=coverage.out -coverpkg=./...` and may need the `-coverpkg` flag tuned per module.

---

## Inter-Module Tests

You can write a test in `server` that imports `auth` directly:

```go
// server/integration_test.go
package server_test

import (
    "testing"

    "example.com/proj/auth"
)

func TestRoundTrip(t *testing.T) {
    tok := auth.New("alice")
    if !auth.Verify(tok) {
        t.Fatal("token did not verify")
    }
}
```

While the workspace is active, `go test ./...` from the workspace root runs this test against `auth`'s local source. Without the workspace (`GOWORK=off`), it runs against whatever `auth` version `server/go.mod` requires. This is exactly the property you want for release-time verification.

A useful pattern: write inter-module integration tests that exercise the seams between your modules. They run quickly inside the workspace and act as a tripwire when you bump a dependency.

---

## Mock-and-Replace Workflows for Forks

You depend on `github.com/upstream/lib v1.4.0`. There is a bug. You fork it to `github.com/me/lib`. You want every module in the workspace to see the fork.

**Bad approach.** Add `replace github.com/upstream/lib => github.com/me/lib v1.4.0-fix1` in every module's `go.mod`.

**Good approach.** Add it once to `go.work`:

```bash
go work edit -replace=github.com/upstream/lib=github.com/me/lib@v1.4.0-fix1
```

Now the workspace builds use the fork. Each module's `go.mod` is unchanged. When the upstream merges your fix and tags `v1.4.1`, drop the workspace replace:

```bash
go work edit -dropreplace=github.com/upstream/lib
go get github.com/upstream/lib@v1.4.1
go work sync
```

Clean.

If you need a *local clone* of the fork rather than a tagged version, use a path:

```bash
go work edit -replace=github.com/upstream/lib=../lib-fork
```

The path can be relative or absolute. The folder must contain a `go.mod`.

---

## Workspaces and `go mod tidy`

`go mod tidy` operates on **a single module**. It is not workspace-aware in the sense of "tidy every listed module." Run it module by module:

```bash
for m in server auth billing; do (cd $m && go mod tidy); done
```

Or use the workspace's `./...` after sync:

```bash
go work sync
go test ./...      # surfaces any missing imports
```

A common confusion: "I added an import in `auth`, ran `go mod tidy` at the workspace root, and the new requirement did not appear in `auth/go.mod`." It will not — `go mod tidy` only touches the module in the current directory.

A subtle interaction: `go mod tidy` in a workspace-listed module may *remove* a require that the module needs in production, because the workspace was satisfying that require via a `use` directive and the toolchain saw no actual import on the public proxy. Always run `go mod tidy` with `GOWORK=off` for release-time tidies:

```bash
cd auth
GOWORK=off go mod tidy
```

This is the canonical "tidy what consumers will see" command.

---

## Migration: From `replace ../sibling` to `go.work`

A team inherits a multi-module repo from 2020. Every `go.mod` has lines like:

```
replace example.com/proj/auth => ../auth
```

These need to come out for clean releases. The migration:

### 1. Create a workspace at the repo root

```bash
go work init ./server ./auth ./billing
```

### 2. Remove the `replace` lines

```bash
sed -i '' '/^replace example\.com\/proj\//d' server/go.mod
# repeat for every module
```

(Hand-review each diff; some `replace` lines may be intentional and not workspace-related.)

### 3. Verify

```bash
go build ./...     # uses the workspace; should still work
GOWORK=off go build ./...    # uses published versions; should also work
```

If the second build fails, you have an actual release-ordering problem hidden under the `replace` directives. The workspace surfaces it. Fix by tagging missing versions and `go get`ting them.

### 4. Commit

```
git add go.work go.work.sum server/go.mod auth/go.mod billing/go.mod
git commit -m "Migrate from in-mod replace to go.work"
```

### 5. Update CI

CI may rely on `GOWORK=off` for honest builds. Add it explicitly to the build step.

---

## Common Pitfalls at this Level

### Pitfall 1 — Forgetting `go work sync` before release

Symptoms: A consumer of `server v0.5.0` complains about a build error that you cannot reproduce. Cause: `server/go.mod` still requires an old version of a transitive dep. Cure: `go work sync` and re-tag.

### Pitfall 2 — Workspace masks a real release-ordering bug

Symptoms: All your local builds pass; your CI's `GOWORK=off` build fails. Cause: You depend on unpublished features of `auth`. Cure: Tag `auth` first, then bump `server`'s `require`.

### Pitfall 3 — Committed `go.work` references a sibling that does not exist for some contributors

Symptoms: Some contributors report `directory ./internal/experimental is not a module`. Cause: They cloned a subset of the repo, or a sub-module was deleted. Cure: Either gitignore `go.work` or fix the layout assumption.

### Pitfall 4 — `go work sync` on a stale workspace

Symptoms: `go work sync` rewrites every `go.mod` with versions you did not intend. Cause: A `replace` in `go.work` is pulling in odd versions, or the workspace lists modules that have not been tidied. Cure: Run `go mod tidy` in every listed module first, then sync.

### Pitfall 5 — Two workspaces shadow each other

Symptoms: Building from `~/proj/inner/api/` does not see modules listed in `~/proj/go.work`. Cause: A nested `~/proj/inner/go.work` is the one being picked up. Cure: Delete the inner file, or set `GOWORK=$HOME/proj/go.work` in your shell.

### Pitfall 6 — `GOWORK=off` not set in CI

Symptoms: CI passes but consumers fail. Cause: CI is unintentionally using a checked-in `go.work` to mask version drift. Cure: Add `env: GOWORK: off` to the release-quality CI steps.

---

## Self-Assessment

You are at this level when you can:

- Sketch a workspace setup for a "library + consumer in one repo" project on a whiteboard.
- Explain when `go work sync` is needed and what it does to each `go.mod`.
- Decide between a `replace` in `go.mod` and one in `go.work` for a given scenario.
- Write a release checklist that includes `GOWORK=off` and `go work sync`.
- Migrate a legacy `replace ../sibling` codebase to a clean workspace.
- Recognise the symptoms of a workspace masking a release-ordering bug.

If two or more of those feel shaky, re-read [The Release-Day Routine](#the-release-day-routine) and try the migration on a small project.

---

## Summary

A workspace is not just a setup step; it is a long-running development tool that needs care across releases. `go work sync` propagates resolved versions back into each module's `go.mod` so published artefacts match what your local build saw. `replace` belongs in `go.work` for development swaps and in `go.mod` only when the substitution is intentional and permanent. Always run `GOWORK=off` builds before tagging, to verify your published versions actually link. Commit `go.work` for tightly coupled monorepos; gitignore it for libraries with diverse contributor layouts. The workspace makes the day-to-day frictionless — the discipline is at the release boundary.
