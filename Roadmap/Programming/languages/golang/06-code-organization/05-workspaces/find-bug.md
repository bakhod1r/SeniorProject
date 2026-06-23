# Workspaces — Find the Bug

> Each scenario contains a real-world bug related to Go workspaces. Find it, explain it, fix it. Solutions are in `<details>` blocks below each bug.

---

## Bug 1 — `go.work` without a `go` directive

```
// go.work
use (
    ./api
    ./shared
)
```

```
$ go build ./...
go: errors parsing go.work:
        go.work:1: unknown directive: use
```

**What is wrong?**

<details>
<summary>Solution</summary>

The `go.work` file requires a `go` directive at the top. Without it, the parser treats the first line (`use`) as the first directive and rejects it because it has not yet established the file format version.

**Fix:** add a `go` directive:

```
go 1.22

use (
    ./api
    ./shared
)
```

The `go` directive must be present and must come first (or at least before any `use`/`replace`).

</details>

---

## Bug 2 — Pointing `use` at a directory without `go.mod`

```
// go.work
go 1.22

use (
    ./pkg/utils
)
```

```
$ ls pkg/utils
helper.go strings.go

$ go build ./...
go: directory pkg/utils is not a module: missing go.mod
```

**What is wrong?**

<details>
<summary>Solution</summary>

The `use` directive lists module folders, not arbitrary Go-package folders. `pkg/utils` contains source files but no `go.mod`, so it is not a module — it is a package within some parent module.

**Fix options:**

- If `pkg/utils` should be its own module, give it one: `cd pkg/utils && go mod init example.com/pkg/utils`. Then `go work use ./pkg/utils` works.
- If `pkg/utils` is a package within a parent module, do not list it. List the parent module instead: `use ./` (where `./` contains the parent's `go.mod`).

A common confusion: people see "I want this folder in the workspace" and write `use`. The right question is "is this folder a module?" If no, list the module that contains it.

</details>

---

## Bug 3 — Forgotten `replace` shipped to consumers

A consumer of `example.com/myapp` reports:

```
$ go get example.com/myapp@v0.5.0
go: module example.com/myapp@v0.5.0 found, but its go.mod requires
        a directory replacement that does not exist:
        replace example.com/myapp/internal/lib => ../lib
```

The maintainer's workspace setup looks fine locally. The bug is in the published `go.mod`:

```
module example.com/myapp
require example.com/myapp/internal/lib v0.0.0
replace example.com/myapp/internal/lib => ../lib
```

**What is wrong?**

<details>
<summary>Solution</summary>

The `replace ../lib` was a development-time shortcut that should never have been published. It points at a relative path on the maintainer's machine; consumers' machines have no `../lib` directory.

**Fix:**

1. Remove the `replace` from `go.mod`.
2. Move the substitution to `go.work` instead: `go work edit -use=./internal/lib` (assuming `internal/lib` is a module).
3. Make sure `./internal/lib` is also a separately-published module — internal-path modules can be tricky; usually the right answer is to combine them or to publish the dependency under its own real path.
4. Re-tag `myapp` (e.g., `v0.5.1`) without the toxic `replace`.

The general rule: any `replace ../something` in `go.mod` is a smell. Move to `go.work`.

</details>

---

## Bug 4 — `GOWORK=off` not set in production CI

A team's CI runs `go test ./...` from the repo root. Tests pass. They tag a release. A consumer reports:

```
go: module example.com/lib@v1.4.0:
        cannot find module providing package example.com/lib/internal/helpers
```

Internal investigation shows: `lib`'s tests imported `helpers` indirectly via a sibling module that the workspace was providing. The consumer's build does not see the workspace.

**What is wrong?**

<details>
<summary>Solution</summary>

CI was running with the workspace active. The cross-module imports were satisfied by `use` directives in `go.work`. Released-version builds, by contrast, do not see `go.work` at all — the consumer pulls only `lib` and tries to find every dependency through the proxy.

**Fix:** add a CI step that builds and tests each released module with `GOWORK=off`:

```yaml
- name: Verify isolated build
  run: GOWORK=off go build ./...
- name: Verify isolated tests
  run: GOWORK=off go test ./...
```

Run this per module in a matrix. The two-build CI strategy from senior.md catches exactly this class of bug before release.

</details>

---

## Bug 5 — Duplicate `use` directive after merge conflict

```
// go.work after a clumsy git merge
go 1.22

use (
    ./api
    ./auth
    ./api
)
```

```
$ go build ./...
go: go.work:6: duplicate use directive ./api
```

**What is wrong?**

<details>
<summary>Solution</summary>

Two branches each added different `use` directives near each other. The merge resolution kept both — including a duplicate of `./api`.

**Fix:**

```bash
go work edit -dropuse=./api
go work edit -use=./api      # if you want it back; just one copy
cat go.work
```

Or hand-edit, removing the duplicate line. Then run `gofmt`-style checks on the file (the toolchain canonicalises whitespace on every `go work edit`).

A deeper fix: protect `go.work` with a CI check that runs `go work edit -fmt` and fails if the file changes. Catches duplication, malformed lines, and stray whitespace.

</details>

---

## Bug 6 — Workspace `go` directive higher than installed Go

A new team member gets:

```
$ go build ./...
go: go.work file requires go 1.22, but go is 1.20
```

The workspace was set up by a colleague with Go 1.22; the new joiner has 1.20.

**What is wrong?**

<details>
<summary>Solution</summary>

The `go.work` file's `go` directive says `go 1.22`. The toolchain refuses to build with an older runtime.

**Fix options:**

1. **Upgrade the new joiner's Go.** Usually the right answer.
2. **Add a `toolchain` directive** so auto-toolchain switching kicks in:

   ```
   go 1.22
   toolchain go1.22.4
   ```

   With `GOTOOLCHAIN=auto` (default since 1.21), the new joiner's `go` will download and use 1.22 transparently.

3. **Lower the `go` directive** — only if every listed module also supports the lower version. Run `go work edit -go=1.20` and verify all modules build.

Option 2 is the modern, friction-free answer. Document a minimum installed Go (`go 1.21+` lets `toolchain` work) and let the directive handle the rest.

</details>

---

## Bug 7 — Stale `go.work` after deleting a module folder

```
// go.work
go 1.22

use (
    ./api
    ./shared
    ./billing
)
```

But `./billing/` was deleted last week. Build:

```
$ go build ./...
go: directory ./billing does not exist
```

**What is wrong?**

<details>
<summary>Solution</summary>

`go.work` lists `./billing`, but the directory has been removed. The toolchain refuses to load a non-existent `use` target.

**Fix:**

```bash
go work edit -dropuse=./billing
```

Or hand-edit `go.work` to remove the line. Always edit `go.work` *before* deleting the underlying folder, so the workspace stays consistent.

</details>

---

## Bug 8 — `replace` in `go.work` shadows a `replace` in `go.mod`

A team is hunting a strange test failure. `auth/go.mod` contains:

```
replace github.com/oldlib/v2 => github.com/oldlib/v2 v2.3.4
```

But `go.work` contains:

```
replace github.com/oldlib/v2 => github.com/oldlib/v2 v2.5.0-rc1
```

The team expects v2.3.4 (the long-tested stable version). The build uses v2.5.0-rc1 and a flaky test fails intermittently.

**What is wrong?**

<details>
<summary>Solution</summary>

When both `go.work` and `go.mod` have a `replace` for the same module, the workspace `replace` wins. The toolchain silently overrides the `go.mod` directive while the workspace is active.

This is documented but surprising. The team's `go.mod` was effectively inert.

**Fix:** decide where the `replace` belongs.

- If the substitution should hold in *production* (released) builds, keep it in `go.mod` and remove it from `go.work`.
- If the substitution is *only* for development (e.g., testing a release candidate), keep it in `go.work` and remove it from `go.mod`.

Never have both. They confuse readers and produce surprising results.

To diagnose: run `go list -m all` inside a workspace-active build and compare against `GOWORK=off go list -m all`. The diff highlights exactly which substitutions the workspace is making.

</details>

---

## Bug 9 — Hand-edited `go.work.sum` causes verification failure

After resolving a merge conflict by hand:

```
$ go build ./...
verifying github.com/foo/bar@v1.2.3/go.mod: checksum mismatch
        downloaded: h1:abcd...
        go.work.sum: h1:wxyz...

SECURITY ERROR
This download does NOT match an earlier download recorded in go.work.sum.
```

**What is wrong?**

<details>
<summary>Solution</summary>

Someone edited `go.work.sum` during a merge and corrupted a hash line. Like `go.sum`, `go.work.sum` is integrity-checked: a single byte change is treated as evidence of tampering and the build is aborted.

**Fix:** restore from git and let the toolchain regenerate:

```bash
git checkout -- go.work.sum
# or, if no clean version exists:
rm go.work.sum
go mod tidy   # in each listed module
go work sync
```

The toolchain will rebuild `go.work.sum` from scratch on the next build. If the merge had genuine conflicts, accept either side wholesale (do not hand-merge), then regenerate.

Never hand-edit `go.sum` or `go.work.sum`.

</details>

---

## Bug 10 — Nested `go.work` shadows the intended one

A monorepo has:

```
mono/
├── go.work               # lists 8 modules
└── experimental/
    ├── go.work           # lists 1 module (just experimental/proto)
    └── proto/
        └── go.mod
```

A developer working on `mono/experimental/proto` complains that imports of other monorepo modules fail:

```
$ go build ./...
no required module provides package example.com/mono/shared
```

**What is wrong?**

<details>
<summary>Solution</summary>

The toolchain walks upward from the current directory and stops at the *first* `go.work` it finds. From `experimental/proto`, the closest `go.work` is `experimental/go.work` — which lists only the experimental module. The outer `mono/go.work` is invisible.

**Fix options:**

1. **Delete `experimental/go.work`** if you intended one workspace for the whole monorepo.
2. **Add the missing modules** to `experimental/go.work`:

   ```
   go 1.22
   use (
       ./proto
       ../shared
       ../auth
   )
   ```

3. **Override with `GOWORK`**:

   ```bash
   GOWORK=$HOME/mono/go.work go build ./...
   ```

The general lesson: only one `go.work` should be on the upward path from any working directory. Nested workspaces are legal but cause exactly this kind of confusion.

</details>

---

## Bug 11 — Workspace masks a missing `require`

In `app/main.go`:

```go
package main

import (
    "fmt"

    "example.com/proj/lib"
)

func main() { fmt.Println(lib.Version) }
```

In `app/go.mod`:

```
module example.com/proj/app

go 1.22

// no require for example.com/proj/lib (!)
```

Inside the workspace (`go.work` lists both `./app` and `./lib`), the build succeeds. The team tags and releases `app v1.0.0`. Consumers complain:

```
$ go get example.com/proj/app@v1.0.0
$ go build
no required module provides package example.com/proj/lib
```

**What is wrong?**

<details>
<summary>Solution</summary>

The workspace was satisfying the `import "example.com/proj/lib"` via the `use ./lib` directive — the import was real, but `go.mod` had no `require` line for it. The toolchain in workspace mode does not complain because the workspace covers the requirement.

When a consumer downloads `app@v1.0.0`, they have only `app/go.mod`, which says nothing about `lib`. The build fails.

**Fix:** ensure `app/go.mod` declares its real dependencies even when the workspace is active. Either:

```bash
cd app
GOWORK=off go mod tidy
```

`go mod tidy` with `GOWORK=off` adds the missing requires honestly. Then `go work sync` propagates resolved versions across the workspace.

Or, more proactively, add the build-with-workspace-off step to CI, which catches this before release. See [Bug 4](#bug-4--gowork-off-not-set-in-production-ci) for the same lesson at the test level.

</details>

---

## Bug 12 — Two contributors with different module layouts

Alice's filesystem:

```
~/work/proj/
├── go.work             # lists ./api ./shared
├── api/
└── shared/
```

Bob's filesystem (cloned `proj` into a deeper folder):

```
~/code/golang/proj/
├── go.work             # the same committed file
├── api/
└── shared/
```

Both work fine — the paths are relative. But Carol cloned the repo using a sparse-checkout that excluded `shared/`:

```
~/work/proj/
├── go.work
└── api/
```

```
$ go build ./...
go: directory shared does not exist
```

**What is wrong?**

<details>
<summary>Solution</summary>

The committed `go.work` lists `./shared`, but Carol's local checkout does not include it. The workspace assumes the on-disk layout matches the `use` paths.

**Fix options:**

1. **Tell Carol to do a full checkout.** Workspaces assume completeness.
2. **Drop `go.work` from version control** and let each contributor write their own. Now Carol can list only `./api`.
3. **Use `GOWORK=off`** for any partial work. The build is then in plain module mode and `shared` resolves through the proxy (assuming it has been published).

A useful policy: if you commit `go.work`, document the assumed layout. If your contributors' layouts vary widely, gitignore `go.work` and provide `go.work.example` instead.

</details>

---

## Bug 13 — `go work sync` produces unexpected version downgrade

A team runs `go work sync` and is shocked to find a `require` line *downgraded*:

```
- require golang.org/x/text v0.14.0
+ require golang.org/x/text v0.10.0
```

**What is wrong?**

<details>
<summary>Solution</summary>

This should not normally happen. `go work sync` propagates the workspace's *resolved* versions, which are the maximum across all listed modules. A downgrade can occur if:

- A `replace` in `go.work` is pinning a lower version than the modules require.
- A listed module was removed from the workspace, and its higher requirement is no longer in scope.
- A previous `go work sync` was run, then someone manually upgraded one `go.mod` and forgot to commit; later sync recomputed without that upgrade.

**Diagnosis:** run `go list -m all` and inspect the resolved versions. Compare to each module's `go.mod` `require` lines.

**Fix:** identify the cause. If a `replace` is pinning low, decide whether the pin is intentional. If a module was removed, decide whether the higher requirement is still needed. After fixing, run `go work sync` again and verify.

In general, `go work sync` should be run in CI with a `git diff --exit-code` check, so any unintended modification is caught at PR time.

</details>

---

## Bug 14 — Per-module `vendor/` ignored by workspace

A team committed each module's `vendor/` directory. They run:

```
$ go build -mod=vendor ./...
go: -mod=vendor cannot be used in workspace mode
```

**What is wrong?**

<details>
<summary>Solution</summary>

`-mod=vendor` requires either a per-module vendor (when `GOWORK=off`) or a workspace-level vendor (when the workspace is active). Mixing the workspace with per-module `vendor/` is rejected.

**Fix options:**

1. **Workspace vendor (Go 1.22+):**

   ```bash
   go work vendor
   go build -mod=vendor ./...
   ```

   Creates a top-level `vendor/` aggregating all listed modules' dependencies.

2. **Disable the workspace:**

   ```bash
   cd module-folder
   GOWORK=off go build -mod=vendor ./...
   ```

   Per-module vendor is honoured.

3. **Drop vendor altogether.** If your build no longer needs offline reproducibility, delete `vendor/` and use the module cache.

Choose based on your CI environment. Air-gapped CIs often want option 1; standard public-internet CIs usually do not need vendor at all.

</details>

---

## Bug 15 — Forgotten workspace inflates a release build

A developer pushes `myapp v2.0.0`. The release artefact is 30% larger than v1.9.x. Investigation shows the binary embeds modules that were only relevant to a sibling module in the workspace.

**What is wrong?**

<details>
<summary>Solution</summary>

The release binary was built inside the workspace. Workspace-active builds may inline cross-module references that would normally be resolved via published modules. In some configurations, the build cache and link decisions differ enough to enlarge the binary.

More commonly, the issue is that a workspace `replace` is silently directing the build to a fork or local copy that is larger than the upstream version.

**Fix:** always build release binaries with `GOWORK=off` from the relevant module:

```bash
cd cmd/myapp
GOWORK=off go build -trimpath -ldflags='-s -w' -o myapp .
```

This guarantees the binary is a function of `cmd/myapp/go.mod` and `go.sum` alone — exactly what a downstream rebuild would produce. Compare the size before and after.

For diagnostics:

```bash
go version -m myapp           # workspace-built
GOWORK=off go version -m myapp-clean    # workspace-off
```

The `-m` output shows the embedded module versions; differences explain the size delta.

</details>

---

## Closing Notes

The recurring themes across these bugs:

1. **`GOWORK=off` is your X-ray vision.** Most "weird" workspace bugs vanish or appear with the workspace disabled. The diff is the diagnostic.
2. **The release boundary is real.** Anything the workspace masks during development will be visible to consumers. CI must run both views.
3. **Never hand-edit `go.sum` or `go.work.sum`.** Both are integrity-checked. Restore from git or regenerate.
4. **Move dev-time `replace` to `go.work`; keep release-time `replace` in `go.mod`.** Mixing them produces surprises.
5. **One `go.work` per concept, at the right level in the tree.** Nested workspaces shadow each other; missing modules break clones.

Build the muscle of running `GOWORK=off go build ./...` periodically. It is one of the cheapest, highest-signal verification commands in Go.
