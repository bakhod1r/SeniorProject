# `go mod tidy` — Find the Bug

> Each snippet contains a real-world bug related to running, skipping, or misusing `go mod tidy`. Find it, explain it, fix it.

---

## Bug 1 — `go.mod` and `go.sum` drift in a PR

```bash
$ git diff origin/main -- go.mod go.sum
# (no output: both unchanged)
$ git diff origin/main -- internal/api
+import "github.com/google/uuid"
+...
+    id := uuid.NewString()
```

```bash
$ go build ./...
internal/api/handler.go:6:2: no required module provides package
github.com/google/uuid; to add it:
    go get github.com/google/uuid
```

**Bug:** The author added a new import in `internal/api/handler.go` but never ran `go mod tidy`. Their local cache had `uuid` from another project, so `go build` happened to succeed on their machine. CI clones a clean checkout where the module is *not* in `go.mod`, so the import resolves to nothing.

**Fix:** run tidy and commit the result alongside the code change:

```bash
$ go mod tidy
$ git add go.mod go.sum
$ git commit --amend --no-edit
$ git push --force-with-lease
```

Add a CI guard so the next PR cannot repeat the mistake:

```bash
$ go mod tidy
$ git diff --exit-code go.mod go.sum
```

---

## Bug 2 — `go.sum` missing from the commit

```bash
$ git diff origin/main --stat
 go.mod                     |  3 +++
 internal/auth/jwt.go       | 12 ++++++++++++
$ git ls-files | grep go.sum
$ # (empty)
```

CI on a fresh checkout:

```bash
$ go build ./...
verifying github.com/golang-jwt/jwt/v5@v5.2.1: missing go.sum entry;
to add it:
    go mod download github.com/golang-jwt/jwt/v5
```

**Bug:** Tidy was run locally and updated both `go.mod` and `go.sum`, but `go.sum` is in `.gitignore` (somebody once thought it was a derived artifact). On a clean clone, no checksum data exists, so the toolchain refuses to fetch the module — even though `go.mod` lists it correctly.

**Fix:** `go.sum` is *part of the source*. Remove it from `.gitignore`, regenerate, and commit:

```bash
$ sed -i.bak '/^go\.sum$/d' .gitignore
$ go mod tidy
$ git add .gitignore go.sum
$ git commit -m "Track go.sum (required for reproducible builds)"
```

---

## Bug 3 — Tidy strips a "reflection-only" dependency

```go
// init.go
package main

import (
    _ "github.com/example/plugin"  // registers itself via init()
)
```

After a refactor someone deletes the blank import "because nothing in the file uses it":

```diff
- import _ "github.com/example/plugin"
```

```bash
$ go mod tidy
$ git diff go.mod
-require github.com/example/plugin v1.4.0
```

At runtime:

```
panic: plugin "example" not registered
```

**Bug:** Tidy strips any module no source file imports. Removing the blank import `_ "github.com/example/plugin"` made tidy correctly conclude the dep was unused — but the developer relied on the package's `init()` side effect.

**Fix:** keep the blank import. It is the *only* signal Go has that the package matters:

```go
import (
    _ "github.com/example/plugin"  // side-effect: registers driver
)
```

For tooling-only deps (linters, codegen) that are not imported anywhere, use a `tools.go` file under a build tag:

```go
//go:build tools
// +build tools

package tools

import _ "github.com/golangci/golangci-lint/cmd/golangci-lint"
```

---

## Bug 4 — Manually deleting `// indirect` markers

```go.mod
require (
    github.com/spf13/cobra v1.8.0
    github.com/inconshreveable/mousetrap v1.1.0  // I removed the // indirect — looked ugly
)
```

```bash
$ go mod tidy
$ git diff go.mod
-    github.com/inconshreveable/mousetrap v1.1.0
+    github.com/inconshreveable/mousetrap v1.1.0 // indirect
```

**Bug:** `// indirect` is not cosmetic. It is set by the toolchain to mean "no package in *this* module imports this one directly — it is here only to pin a version forced by a transitive dep." Tidy re-derives that flag every run, so any hand-removal is reverted on the next tidy.

**Fix:** never edit the `// indirect` markers by hand. If you actually want a dep to be direct, import it from your own code:

```go
import "github.com/inconshreveable/mousetrap"
```

…and tidy will drop the `// indirect` automatically.

---

## Bug 5 — Wrong `-compat` flag strips entries old consumers need

```bash
$ go version
go version go1.22.0 darwin/arm64
$ go mod tidy -compat=1.22
```

A teammate still on Go 1.19 then pulls main:

```bash
$ go build ./...
go: github.com/foo/bar@v1.3.0 requires
    github.com/baz/qux@v1.0.5: missing go.sum entry
```

**Bug:** `-compat` controls which Go versions tidy keeps the *transitive* graph compatible with. Bumping it from `1.19` to `1.22` means tidy is allowed to drop transitive entries that older Go versions need (lazy module loading rules differ across versions). The local build keeps working; older toolchains cannot resolve the now-missing graph.

**Fix:** match `-compat` to the *minimum* Go version any consumer might use, not your local version:

```bash
$ go mod tidy -compat=1.19
```

Or, better, pin the team's minimum in `go.mod` and let tidy default:

```go.mod
go 1.19
```

```bash
$ go mod tidy   # uses go directive as -compat default
```

---

## Bug 6 — Build-tagged import that tidy cannot see

```go
//go:build linux

package monitor

import "github.com/prometheus/procfs"
```

The developer is on macOS:

```bash
$ go mod tidy
$ git diff go.mod
-require github.com/prometheus/procfs v0.12.0
```

CI on Linux:

```bash
$ go build ./...
monitor/linux.go:5:2: no required module provides package
github.com/prometheus/procfs
```

**Bug:** Tidy walks imports under the *current* GOOS/GOARCH and active build tags. A file gated by `//go:build linux` is invisible from a macOS dev box, so tidy "correctly" concludes the import is unused and drops it.

**Fix:** tell tidy to keep the union of imports across all build configurations using `-compat` or the newer `all` package pattern. Since Go 1.17 the canonical answer is to ensure the right set of GOOS values is considered:

```bash
$ GOOS=linux go mod tidy
$ GOOS=darwin go mod tidy   # then re-tidy on host platform
```

A more robust pattern: use a `tools.go` (with the `tools` build tag) to anchor any import that must stay listed regardless of platform.

---

## Bug 7 — Typo in import path

```go
import "github.com/spf13/cobrra"  // double 'r'
```

```bash
$ go mod tidy
go: finding module for package github.com/spf13/cobrra
go: found github.com/spf13/cobrra in github.com/spf13/cobrra v0.0.0-...
go: example.com/me/app imports
    github.com/spf13/cobrra: github.com/spf13/cobrra@v0.0.0-...:
    no matching versions for query "upgrade"
```

or, more confusingly:

```
no required module provides package github.com/spf13/cobrra
```

**Bug:** Tidy tried to resolve the typo'd path. Either nothing exists there (clear failure), or — worse — somebody is squatting the path and you accidentally pull in malicious code.

**Fix:** read the import path character by character against the upstream README. Then:

```go
import "github.com/spf13/cobra"
```

```bash
$ go mod tidy
```

Pin a linter rule (`gofmt`, `goimports`) or editor LSP that auto-completes import paths from real modules — typing them by hand is the bug.

---

## Bug 8 — Ambiguous import after a major-version bump

```go.mod
require (
    github.com/foo/bar      v1.9.0
    github.com/foo/bar/v2   v2.1.0
)
```

```go
import "github.com/foo/bar/baz"
```

```bash
$ go mod tidy
go: ambiguous import: found package github.com/foo/bar/baz in multiple
modules:
    github.com/foo/bar v1.9.0 (.../bar@v1.9.0/baz)
    github.com/foo/bar/v2 v2.1.0 (.../bar/v2@v2.1.0/baz)
```

**Bug:** Both `v1` and `v2` of the module are required (one came in transitively). The same package path `bar/baz` resolves under each, so tidy refuses to guess which you meant.

**Fix:** pick one and update *every* import to match:

```go
import "github.com/foo/bar/v2/baz"
```

Then drop the older major from the graph:

```bash
$ go get github.com/foo/bar/v2@latest
$ go mod tidy
```

If a transitive dep is what pulled in `v1`, upgrade *that* dep first; the conflict usually resolves itself.

---

## Bug 9 — `go.sum` deleted "to clean up"

```bash
$ rm go.sum   # I'll regenerate it
$ go build ./...
verifying github.com/spf13/cobra@v1.8.0: missing go.sum entry; to add it:
    go mod download github.com/spf13/cobra
```

**Bug:** Deleting `go.sum` removes the only checksum record. `go build` refuses to fetch unverified modules. The fix is *not* to run a long chain of `go mod download` per module.

**Fix:** tidy re-derives `go.sum` from `go.mod` and the proxy's content:

```bash
$ go mod tidy
$ git status
modified:   go.sum
```

If you have a vendor tree, also `go mod vendor`. Commit both files.

---

## Bug 10 — Tidy succeeds locally, fails in CI

```bash
$ go mod tidy   # local: clean
$ git push
```

CI:

```
go: updates to go.mod needed; to update it:
    go mod tidy
exit code 1
```

`.github/workflows/ci.yml`:

```yaml
env:
  GOFLAGS: -mod=readonly
  GO_VERSION: 1.19
```

**Bug:** Two compounding issues:
1. CI runs Go `1.19`, but the developer's machine has `1.22`. Tidy normalises slightly different graphs across versions, so the file the dev produced is "not what `1.19` would have produced."
2. `GOFLAGS=-mod=readonly` *forbids* tidy-style mutations in CI — which is what you want, but the failure message tells you nothing about Go version mismatch.

**Fix:** pin the Go version everywhere:

```yaml
- uses: actions/setup-go@v5
  with:
    go-version-file: 'go.mod'   # single source of truth
```

Then run a *check-only* tidy in CI:

```bash
$ go mod tidy -diff
# or
$ go mod tidy && git diff --exit-code go.mod go.sum
```

Match the directive in `go.mod` (`go 1.22`) to the floor of supported toolchains so devs and CI agree.

---

## Bug 11 — Tidy churns on every run (OS-conditional import)

Every developer's PR includes:

```diff
-require golang.org/x/sys v0.20.0 // indirect
+require golang.org/x/sys v0.20.0 // indirect
```

…or the line *moves* between blocks unpredictably.

**Bug:** Some package is imported only on certain GOOS values. Tidy on macOS produces one normalised graph; tidy on Linux produces a slightly different one. Each developer "fixes" the file for their OS and the next person flips it back.

**Fix:** the canonical fix is to make every developer (and CI) run tidy under the same configuration. Modern Go (`1.17+`) handles this automatically via *module graph pruning*, but only if the `go` directive is recent enough:

```go.mod
go 1.21
```

If churn persists, run tidy across both common targets:

```bash
$ GOOS=linux  go mod tidy
$ GOOS=darwin go mod tidy
$ git diff go.mod   # should now be empty
```

Commit the result. Add to CI a job that runs the same dual-tidy and fails on diff.

---

## Bug 12 — Local-path `replace` leaks into the committed `go.mod`

```go.mod
require github.com/me/shared v1.4.0

replace github.com/me/shared => ../shared
```

A teammate clones and runs:

```bash
$ go mod tidy
go: errors parsing go.mod:
    go.mod:7: replacement directory ../shared does not exist
```

**Bug:** A `replace` pointing at a relative local path works only on the machine where that path resolves. Once committed, every other developer (and CI) chokes because `../shared` does not exist in their checkout.

**Fix:** keep local-only redirections in `go.work`, never `go.mod`:

```bash
$ go work init . ../shared
$ git rm --cached go.work go.work.sum   # if accidentally tracked
$ echo go.work >> .gitignore
$ echo go.work.sum >> .gitignore
```

Strip the `replace` from `go.mod`:

```bash
$ go mod edit -dropreplace=github.com/me/shared
$ go mod tidy
```

If you genuinely need a long-term redirect (e.g. a fork), use a published version instead:

```go.mod
replace github.com/me/shared => github.com/me/shared-fork v1.4.1
```

---

## Bug 13 — `vendor/modules.txt` out of sync after tidy

```bash
$ go mod tidy            # I added a new dep
$ git add go.mod go.sum
$ git commit -m "Add new dep"
$ git push
```

CI:

```
go: inconsistent vendoring in /workspace:
    github.com/google/uuid@v1.6.0: is explicitly required in go.mod, but
    not marked as explicit in vendor/modules.txt
    run 'go mod vendor' to sync
```

**Bug:** The repo uses `vendor/`. Tidy updates `go.mod` / `go.sum` but does **not** rewrite the vendor tree. The two views of the dep graph now disagree, and CI runs in `-mod=vendor` by default for vendored repos.

**Fix:** tidy and vendor together — make this a single command in your team's workflow:

```bash
$ go mod tidy
$ go mod vendor
$ git add go.mod go.sum vendor
$ git commit -m "Add uuid (mod + vendor in sync)"
```

Add a Makefile target:

```make
deps:
	go mod tidy
	go mod vendor
	git diff --exit-code go.mod go.sum vendor
```

---

## Bug 14 — Tidy fetches over network in offline CI

CI logs:

```
$ go mod tidy
go: github.com/spf13/cobra@v1.8.0: Get "https://proxy.golang.org/...":
    dial tcp: lookup proxy.golang.org: no such host
```

The CI runner is air-gapped and the dev expected the local cache to suffice.

`.envrc`:

```
GOFLAGS=-mod=mod
GOMODCACHE=/tmp/empty-cache
```

**Bug:** `GOFLAGS=-mod=mod` tells tidy it may *download* modules to update the graph. Combined with an empty module cache, every tidy run requires network access — which the CI does not have.

**Fix:** in offline / air-gapped CI, never run tidy. Instead:

1. Run tidy *upstream* (developer's machine or a network-enabled job).
2. Vendor: `go mod vendor`.
3. Commit `vendor/`.
4. CI builds with `-mod=vendor`:

```bash
$ go build -mod=vendor ./...
```

If you must tidy in a controlled environment, point `GOPROXY` at an internal mirror (Athens, Artifactory) and pre-warm `GOMODCACHE`.

---

## Bug 15 — Checksum mismatch after pulling main

```bash
$ git pull
$ go mod tidy
verifying git.acme.internal/team/utils@v1.5.0: checksum mismatch
    downloaded: h1:abc...
    go.sum:     h1:xyz...
SECURITY ERROR
```

**Bug:** The internal module is being verified against `sum.golang.org`, the public checksum DB, which has never seen it. Either Go is fetching a different artifact than the original author saw, or the public DB returned a "missing" placeholder that does not match the local hash.

**Fix:** mark the namespace private so tidy bypasses the public sumdb:

```bash
$ go env -w GOPRIVATE=git.acme.internal,*.acme.internal
$ go env -w GONOSUMCHECK=git.acme.internal,*.acme.internal
$ rm go.sum   # if poisoned by a prior bad fetch
$ go mod tidy
```

Bake the env into a checked-in script (`scripts/setup-go-env.sh`) so every developer and CI has the same configuration.

---

## Bug 16 — Wrong `GOPRIVATE` leaks internal modules to public sumdb

```bash
$ go env GOPRIVATE
*.acme.com
$ go mod tidy
# (silent success)
```

Hours later, security alerts: a request for
`git.acme.internal/billing/secrets/@v/list` shows up in `sum.golang.org` logs.

**Bug:** `GOPRIVATE=*.acme.com` matches `acme.com` namespaces, but the internal Git server is at `git.acme.internal`. The pattern does not match, so tidy went to the *public* checksum DB to verify it — which is a leak of the module path (and therefore of internal product names).

**Fix:** widen the pattern to cover every internal host:

```bash
$ go env -w GOPRIVATE='*.acme.com,*.acme.internal,git.acme.internal'
```

Or use the broader `GONOSUMDB`:

```bash
$ go env -w GONOSUMCHECK='*.acme.internal'
```

Audit by grepping logs for any internal path that left the network. Treat sumdb leaks as P1 — once a module name is public, it cannot be unpublished.

---

## Bug 17 — Tidy adds a vulnerable transitive dep

```bash
$ go mod tidy
$ govulncheck ./...
Vulnerability #1: GO-2024-1234
    Package: github.com/old/crypto v1.0.0
    ...
```

The developer never imported `github.com/old/crypto` directly.

**Bug:** Tidy uses MVS (Minimum Version Selection): for each module, the build picks the *highest* version anyone in the dep graph requires. A transitive dep added a `require github.com/old/crypto v1.0.0` and that version has a known CVE. Nothing about your direct imports caused the vulnerability — but you are still shipping it.

**Fix:** force a higher (patched) version with a top-level `require` or `replace`:

```bash
$ go get github.com/old/crypto@v1.0.5
$ go mod tidy
```

The `v1.0.5` line in your `go.mod` is now the highest version in the graph, so MVS picks it. Re-run `govulncheck` to confirm. For sustained safety, add `govulncheck` to CI.

---

## Bug 18 — `tidy -e` masks real errors

CI green:

```bash
$ go mod tidy -e
$ go build ./...
internal/auth/handler.go:8:2: no required module provides package
github.com/example/forgot-to-add
```

**Bug:** `-e` ("keep going on errors") is meant for diagnosing partial failures. Used in normal workflows it silences problems tidy *should* surface — like an unresolvable import or a removed package — and produces a `go.mod` that is missing entries.

**Fix:** strip `-e` from scripts, Makefiles, and CI:

```diff
-run: go mod tidy -e
+run: go mod tidy
```

Use `-e` only as a one-off when investigating *why* tidy fails — and then fix the underlying error.

---

## Bug 19 — A direct dep silently flips to `// indirect`

PR diff:

```diff
 require (
-    github.com/google/uuid v1.6.0
+    github.com/google/uuid v1.6.0 // indirect
 )
```

The reviewer assumes the dep is being removed, requests changes; the author insists nothing changed. Both are confused.

**Bug:** The refactor removed the only `import "github.com/google/uuid"` from the project's source — but a transitive dep still references uuid. So tidy correctly flips the marker: from the project's perspective the dep is no longer direct.

**Fix:** read the diff intent, not the symbols. Two valid responses:

1. **Keep using uuid in your code.** Restore the import where it makes sense and tidy will drop `// indirect`.
2. **Accept the flip.** Add a PR comment: *"uuid is now only used transitively; the indirect marker is correct."*

Either way, never hand-edit the marker (see Bug 4).

---

## Bug 20 — Running tidy from a sub-folder of the module

```bash
$ pwd
/Users/me/code/myapp/internal/api
$ go mod tidy
# (no output, no diff)
$ cd /Users/me/code/myapp
$ go mod tidy
go: finding module for package github.com/google/uuid
$ git diff go.mod
+    github.com/google/uuid v1.6.0
```

**Bug:** The first run *did* operate on the parent `go.mod` (Go walks up to find one), but only updates entries it can derive from packages *visible from the current directory's package path*. From `internal/api`, the rest of the project is invisible to tidy unless you ask for `./...` from the module root.

**Fix:** always run tidy from the module root, and pass `./...` so every package is considered:

```bash
$ cd $(go list -m -f '{{.Dir}}')
$ go mod tidy
```

Wrap it in a Makefile target so nobody has to remember:

```make
.PHONY: tidy
tidy:
	cd $(shell go list -m -f '{{.Dir}}') && go mod tidy
```

---

## Bug 21 — `go build` succeeds without `go.sum`, hiding non-reproducibility

```bash
$ rm go.sum
$ go build ./...
# build succeeds (cache hit on every dep)
$ git status
deleted:    go.sum
$ git commit -am "build still works without go.sum 🤷"
```

Two weeks later, on a fresh CI runner:

```
verifying github.com/spf13/cobra@v1.8.0: missing go.sum entry
```

**Bug:** Without `go.sum`, the *first* build after deletion uses whatever is already in your local module cache — no verification. The build succeeded but the artifact is unverifiable: a malicious proxy could swap the contents on any *other* machine and you would not notice.

**Fix:** treat a missing `go.sum` as data corruption. Recover with tidy, never with "well, it built":

```bash
$ go mod tidy
$ git add go.sum
$ git commit -m "Restore go.sum"
```

Add CI guard:

```bash
$ test -s go.sum || { echo "go.sum missing or empty"; exit 1; }
```

---

## Bug 22 — `replace` to a local path with mismatched module identity

Folder layout:

```
/Users/me/code/
    myapp/         (module example.com/me/myapp)
    helper/        (the directory)
        go.mod     (declares: module example.com/me/utility-pkg)
```

```go.mod
require example.com/me/utility-pkg v0.0.0

replace example.com/me/utility-pkg => ../helper
```

```bash
$ go mod tidy
go: errors parsing go.mod:
    /Users/me/code/myapp/go.mod:8:
    require example.com/me/utility-pkg: replacement directory ../helper
    has go.mod listing module example.com/me/utility-pkg
    (consistent — but the package import paths your code uses do not match)
```

…or the more common failure when paths really do disagree:

```
go: example.com/me/helper@v0.0.0 (replaced by ../helper):
    parsing ../helper/go.mod: but was example.com/me/utility-pkg
```

**Bug:** `replace` is purely path-level: it rewires *one module path* to another location. The `go.mod` *inside* the target directory still declares its own module identity. If your `require` says one path and the directory's `go.mod` declares another, tidy bails with a confusing error because it cannot reconcile the two.

**Fix:** make the names match. Pick one canonical module path and update the side that is wrong:

Option A — fix the `go.mod` in the local folder:

```go.mod
// /Users/me/code/helper/go.mod
module example.com/me/utility-pkg
```

Option B — fix the require/replace pair:

```go.mod
require example.com/me/helper v0.0.0
replace example.com/me/helper => ../helper
```

Then:

```bash
$ go mod tidy
```

For real-world multi-module workflows, prefer `go.work` over `replace`. It enforces consistency across all member modules at workspace-resolution time and gives clearer errors.

---

## Bug 23 — Forgetting `go.sum` updates after `go get -u`

```bash
$ go get -u github.com/spf13/cobra
$ git diff
modified:   go.mod
$ git status
# go.sum: untracked? committed? unclear
```

A teammate pulls and runs `go build`:

```
verifying github.com/spf13/cobra@v1.9.1: checksum mismatch
```

**Bug:** `go get -u` updates `go.mod` and `go.sum` together — but if the developer only stages `go.mod`, the `go.sum` change stays uncommitted. The teammate's `go.sum` references the old version.

**Fix:** stage `go.mod` and `go.sum` as a unit, every time:

```bash
$ go get -u github.com/spf13/cobra
$ go mod tidy
$ git add go.mod go.sum
$ git commit -m "Bump cobra to v1.9.1"
```

A pre-commit hook can enforce this:

```bash
if git diff --cached --name-only | grep -qE '^go\.mod$' \
   && ! git diff --cached --name-only | grep -qE '^go\.sum$'; then
    echo "go.mod changed but go.sum not staged — did you forget?"
    exit 1
fi
```

---

## Summary

`go mod tidy` is the reconciliation step between your *imports* (the source of truth in `.go` files) and your *requires* (the manifest in `go.mod`). Most bugs on this page reduce to one of four mistakes:

1. **Skipping tidy when imports change.** New import, removed import, refactor — every change must be followed by `go mod tidy && git add go.mod go.sum`.
2. **Editing `go.mod` or `go.sum` by hand.** Versions, indirect markers, and checksums are derived. Use `go get`, `go mod edit`, and `go mod tidy`.
3. **Letting environment differences speak louder than the manifest.** Different Go versions, GOOS, build tags, GOPRIVATE settings, or `GOFLAGS` change what tidy produces. Pin them.
4. **Treating `replace` and `go.work` as production tools.** They are local-only conveniences; they belong in `.gitignore` (or in a careful, documented monorepo workflow).

Run tidy on every change, gate it in CI with `git diff --exit-code`, and most of the surprises above never reach `main`.
