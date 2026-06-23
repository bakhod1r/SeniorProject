# `go mod vendor` — Find the Bug

> Each snippet contains a real-world bug related to vendoring Go dependencies. `go mod vendor` copies every required module into a top-level `vendor/` directory and writes a `vendor/modules.txt` manifest; from Go 1.14 onward, builds inside a module that contains a `vendor/` directory automatically use it (`-mod=vendor`). Find the bug, explain it, fix it.

---

## Bug 1 — `go.mod` updated, vendor not regenerated

```bash
$ go get github.com/google/uuid@v1.6.0
$ git add go.mod go.sum
$ git commit -m "Add uuid dep"
$ go build ./...
go: inconsistent vendoring in /Users/me/code/myapp:
	github.com/google/uuid@v1.6.0: is explicitly required in go.mod, but
	not marked as explicit in vendor/modules.txt
	(Use "go mod vendor" or "go work vendor" to sync.)
```

**Bug:** `go get` updated `go.mod` and `go.sum`, but the developer forgot to run `go mod vendor`. The `vendor/modules.txt` manifest no longer matches `go.mod`, so the toolchain refuses to build rather than silently mixing fresh and vendored deps.

**Fix:** any time you change `go.mod` (`go get`, `go mod tidy`, manual edit) you must regenerate `vendor/`:

```bash
$ go mod tidy
$ go mod vendor
$ git add go.mod go.sum vendor
$ git commit --amend --no-edit
```

Make this a CI guard:

```bash
$ go mod vendor
$ git diff --exit-code vendor go.mod go.sum
```

---

## Bug 2 — `vendor/modules.txt` not committed (`.gitignore`d)

```gitignore
# .gitignore
vendor/
!vendor/*/
*.txt
```

```bash
$ git clone repo && cd repo
$ go build ./...
go: inconsistent vendoring in /tmp/repo:
	missing vendor/modules.txt
```

**Bug:** A previous `.gitignore` rule excluded all `*.txt` files — including `vendor/modules.txt`. The vendor tree was committed but the manifest was silently dropped. Without `modules.txt`, the toolchain has no way to know which packages are vendored and treats the whole tree as inconsistent.

**Fix:** un-ignore the manifest explicitly and re-vendor:

```gitignore
# .gitignore
*.txt
!vendor/modules.txt
```

```bash
$ go mod vendor
$ git add vendor/modules.txt
$ git commit -m "Restore vendor/modules.txt"
```

Better: do not blanket-ignore `*.txt`. Vendor is checked in as a whole or not at all.

---

## Bug 3 — Hand-edit to vendored source

```bash
$ vim vendor/github.com/foo/bar/parser.go   # patched a panic
$ go build ./...                            # works
$ go mod verify
github.com/foo/bar v1.2.0: dir has been modified (vendor/...)
```

**Bug:** Editing a file inside `vendor/` makes the local source diverge from the upstream module. `go mod verify` (and security tooling like `govulncheck`, supply-chain scanners) flag the divergence. Worse, the next `go mod vendor` overwrites the patch silently — your fix vanishes after any teammate runs vendor.

**Fix:** never patch under `vendor/`. Use a `replace` directive that points to your fork or a local path:

```bash
$ go mod edit -replace=github.com/foo/bar=github.com/me/bar-fork@v1.2.0-fix
$ go mod tidy
$ go mod vendor
```

Or for a tiny, urgent patch keep the fork in-tree:

```go.mod
replace github.com/foo/bar => ./third_party/bar
```

Either way the change is auditable and survives `go mod vendor`.

---

## Bug 4 — Skipping `go mod tidy` before `go mod vendor`

```bash
$ # remove an old import from main.go
$ go mod vendor
$ ls vendor/github.com/old/legacy
parser.go  legacy.go   # still here!
```

**Bug:** `go mod vendor` copies whatever `go.mod` says is required. If `go.mod` still lists `github.com/old/legacy` because nobody ran `go mod tidy` after deleting the last import, the stale dep sits in `vendor/` forever — bloating the repo, dragging in CVEs, and confusing security audits.

**Fix:** always tidy before vendoring:

```bash
$ go mod tidy
$ go mod vendor
$ git status   # confirm vendor/ shrank as expected
```

Add a CI step:

```bash
go mod tidy && go mod vendor && git diff --exit-code
```

---

## Bug 5 — CI accidentally uses `-mod=mod`

```yaml
# .github/workflows/ci.yml
- run: go build -mod=mod ./...
```

**Bug:** From Go 1.14, a module containing `vendor/` defaults to `-mod=vendor`. Forcing `-mod=mod` overrides that and makes the build fetch fresh deps from `proxy.golang.org`, ignoring everything in `vendor/`. The whole point of vendoring (reproducibility, offline builds, locked supply chain) is silently defeated. Worse, network flakes start showing up in CI logs.

**Fix:** drop the flag, or set it to `vendor` explicitly:

```yaml
- run: go build -mod=vendor ./...
- run: go test -mod=vendor ./...
```

In `Makefile`:

```make
GOFLAGS ?= -mod=vendor
export GOFLAGS
```

If you really want to test `mod` mode, run it as a separate job — never on the default build.

---

## Bug 6 — `## explicit` marker drift

```text
# vendor/modules.txt
# github.com/sirupsen/logrus v1.9.3
## explicit; go 1.13
github.com/sirupsen/logrus
```

```go.mod
require github.com/sirupsen/logrus v1.9.3 // indirect
```

```bash
$ go build ./...
go: inconsistent vendoring in /code/myapp:
	github.com/sirupsen/logrus@v1.9.3: is marked as explicit in
	vendor/modules.txt, but not explicitly required in go.mod
```

**Bug:** A refactor stopped using `logrus` directly, so `go mod tidy` demoted it to `// indirect`. But `vendor/modules.txt` still says `## explicit`. The manifest now disagrees with `go.mod` about who is a direct dep.

**Fix:** never edit `modules.txt` by hand. Re-run vendor after every tidy:

```bash
$ go mod tidy
$ go mod vendor
$ git diff vendor/modules.txt
```

The `## explicit` lines should now reflect only direct requires.

---

## Bug 7 — Cross-platform vendoring loses Linux files

```bash
# developer Mac
$ go mod vendor
$ git add vendor && git commit -m "vendor"
$ git push

# CI Linux
$ go build ./...
vendor/golang.org/x/sys/unix/ztypes_linux_amd64.go: not found
```

**Bug:** On Mac, `go mod vendor` only copies files that pass the *current* build constraints by default — except it actually copies all platform-tagged files that any package mentions. The trap is when a build tag is exotic (e.g. `//go:build linux && cgo`) and a custom build script disables CGO during vendoring; the Linux-only files get pruned.

**Fix:** vendor with a clean environment that does not constrain build tags:

```bash
$ env -i HOME="$HOME" PATH="$PATH" \
    GOFLAGS= GOOS= GOARCH= CGO_ENABLED=1 \
    go mod vendor
```

Verify the tree is platform-complete:

```bash
$ grep -r "ztypes_linux_amd64" vendor/golang.org/x/sys/unix/
```

For CI determinism, vendor on the *target* platform (a Linux container) and commit the result.

---

## Bug 8 — `replace` to a local path leaks into vendor

```go.mod
require github.com/me/shared v1.4.0

replace github.com/me/shared => ../shared-local
```

```bash
$ go mod vendor
$ git diff vendor/github.com/me/shared/
+ a thousand lines of work-in-progress code
```

**Bug:** `replace` directives apply during `go mod vendor`. The vendored copy is whatever `../shared-local` looks like *right now* — including uncommitted scratch code. The reviewer sees an enormous, unrelated diff and assumes it was pulled from upstream.

**Fix:** never vendor with a local-path `replace` active. Either:

1. Commit and tag `shared` first, change `replace` to a versioned form, then vendor:
   ```bash
   $ go mod edit -replace=github.com/me/shared=github.com/me/shared@v1.4.1
   $ go mod tidy && go mod vendor
   ```
2. Move local replaces out of `go.mod` entirely and into a workspace:
   ```bash
   $ go work init . ../shared-local
   ```
   Workspaces are not honored by `go mod vendor`, so `go.mod`'s pinned version is what gets vendored — exactly what reviewers expect.

---

## Bug 9 — Two `go mod vendor` runs produce different output

```bash
$ go mod vendor && md5 vendor/modules.txt
d41d...
$ go mod vendor && md5 vendor/modules.txt
e99a...
```

**Bug:** A dependency contains files named like `internal_test.go` but with a custom build tag `//go:build smoke` (not the standard `_test.go` ending in `_test`). `go mod vendor` skips real `*_test.go` test files but copies these because the filename doesn't match. A second run, with a different `GOFLAGS` or build cache state, picks a different subset — vendor output is non-deterministic.

**Fix:** rename mis-named files in your fork or open an upstream PR to use the canonical `_test.go` suffix. As a workaround, exclude with a `replace` to a fork that strips them. Always pin vendor determinism in CI:

```bash
$ go mod vendor
$ git diff --exit-code vendor   # any diff = non-determinism
```

If output drifts run-to-run, treat it as a bug — file an upstream issue.

---

## Bug 10 — `go get pkg@latest` without re-vendoring

```bash
$ go get github.com/spf13/cobra@latest
$ git add go.mod go.sum
$ git commit -m "Bump cobra"
$ go build ./...                       # uses vendored OLD cobra silently
$ go test ./... -run TestNewFeature    # FAIL: feature missing
```

**Bug:** `go get` updated `go.mod` and `go.sum` to the new version, but the build (running in `-mod=vendor` because `vendor/` exists) keeps using the old vendored code. The "upgrade" never reached the binary.

Worst case: CI passes (because CI also vendors), nobody notices, the bump is reverted weeks later as a "broken release."

**Fix:** any version-changing command must be followed by vendor regeneration:

```bash
$ go get github.com/spf13/cobra@latest
$ go mod tidy
$ go mod vendor
$ git add go.mod go.sum vendor
$ git commit -m "Bump cobra to latest"
```

Encode it as a single script:

```bash
#!/usr/bin/env bash
set -euo pipefail
go get "$@"
go mod tidy
go mod vendor
```

---

## Bug 11 — Required `_test.go` of a dependency missing in vendor

```bash
$ go test -tags=integration ./...
vendor/github.com/foo/bar/testutil/fake.go: cannot find package
```

**Bug:** A custom build configuration imports `github.com/foo/bar/testutil` whose source lives entirely under files matching `*_test.go`. `go mod vendor` strips test files by default, so the helper package is missing in the vendor tree even though it compiles fine in module mode.

**Fix:** if you genuinely need test-only code from a dep, do not depend on `_test.go` files — they are not part of the module's API. Either:

- Ask upstream to move the helpers out of `_test.go` into a `testing` sub-package.
- Vendor a fork that renames the file.
- Copy the helper into your own internal package.

Vendoring `_test.go` is not supported and you should not try to work around the rule.

---

## Bug 12 — `go:embed` asset not vendored

```go
// in dep github.com/foo/templates
//go:embed assets/logo.svg
var logo []byte
```

```bash
$ go mod vendor
$ ls vendor/github.com/foo/templates/assets/
ls: vendor/github.com/foo/templates/assets/: No such file or directory
$ go run .
panic: pattern assets/logo.svg: no matching files found
```

**Bug:** Older Go versions (`< 1.14` via backports, or buggy custom tooling) skip non-`.go` files when vendoring. The dep's binary asset is missing, so `go:embed` fails at compile time.

In modern Go, `go mod vendor` *does* copy embedded files — but only if the embed pattern is reachable from a package that is actually imported. If a sub-package providing the embed is unused on the build path you took, it gets pruned.

**Fix:** ensure your toolchain is current (`go version` ≥ 1.16) and that the package containing the `//go:embed` directive is in the import graph. Verify:

```bash
$ go list -deps ./... | grep github.com/foo/templates
$ ls vendor/github.com/foo/templates/assets/
logo.svg
```

If still missing, re-vendor with a clean cache:

```bash
$ go clean -modcache
$ go mod vendor
```

---

## Bug 13 — Mixed-case module path on Linux CI

```go.mod
require github.com/Masterminds/semver/v3 v3.2.1
```

```bash
$ go mod vendor
$ ls vendor/github.com/
masterminds/   # all lowercase!
$ go build ./...
vendor/github.com/Masterminds/semver/v3: cannot find package
```

**Bug:** On a developer's Mac (case-insensitive HFS+/APFS), `vendor/github.com/Masterminds/...` and `vendor/github.com/masterminds/...` are the same directory. Git stores it however it was first committed. On Linux CI (case-sensitive ext4), the import path `Masterminds` does not match the on-disk lowercase directory and the build fails.

`$GOPATH/pkg/mod` avoids this by `!`-escaping uppercase letters (`!masterminds`), but `vendor/` preserves the original case — and is at the mercy of git/filesystem normalization.

**Fix:** ensure `git config core.ignorecase false` on the developer machine so case changes are visible. Re-vendor and force-add:

```bash
$ git rm -r --cached vendor/github.com/masterminds
$ go mod vendor
$ git add vendor/github.com/Masterminds
$ git commit -m "Restore correct case for Masterminds"
```

Better: prefer modules whose authors lowercase their paths.

---

## Bug 14 — `-mod=vendor` on Go 1.13

```bash
$ go version
go version go1.13.15 linux/amd64
$ go build ./...
go: cannot find main module; see 'go help modules'
```

**Bug:** Go 1.13 does not auto-detect `vendor/` and does not default to `-mod=vendor`. Modules are still in transition. Without an explicit flag the build behaves as if vendoring did not exist — and may even fail to find the module root.

**Fix:** either upgrade to Go 1.14+ (strongly recommended in 2026 — 1.13 is years past EOL) or pass the flag explicitly everywhere:

```bash
$ go build -mod=vendor ./...
$ export GOFLAGS=-mod=vendor
```

Document the minimum toolchain in `go.mod` so users get a clear error:

```go.mod
go 1.21
```

---

## Bug 15 — `go.work` overrides vendor

```text
# go.work
go 1.22

use (
    .
    ../shared
)
```

```bash
$ go build ./...
# uses ../shared, ignores vendor/github.com/me/shared
```

**Bug:** When a `go.work` file is in scope, the workspace takes precedence over `vendor/`. The build silently swaps in the live `../shared` directory and never touches the vendored copy. CI (which has no workspace) and dev (which does) build different code.

**Fix:** disable workspace mode when vendoring is supposed to be authoritative:

```bash
$ GOFLAGS="-mod=vendor" GOWORK=off go build ./...
```

Or remove the workspace from the build environment entirely:

```bash
$ unset GOWORK   # implicit detection
$ export GOWORK=off
```

In CI:

```yaml
env:
  GOWORK: off
```

Document the rule: `go.work` is a developer convenience; vendor is source-of-truth.

---

## Bug 16 — `GOFLAGS=-mod=mod` in the user environment

```bash
$ env | grep GOFLAGS
GOFLAGS=-mod=mod
$ go build ./...
# pulls deps from the network even though vendor/ exists
```

**Bug:** A teammate set `GOFLAGS=-mod=mod` in their shell to "fix" an unrelated module issue and never unset it. Every subsequent build in *every* repo on their machine ignores `vendor/`. Output looks normal until a network outage, a CVE in a fresh upstream version, or a checksum drift exposes the discrepancy.

**Fix:** clear the env override; let each repo's defaults win:

```bash
$ unset GOFLAGS
```

Pin per-project via `go env -w` only for that project's directory if needed. CI must always explicitly set the desired mode:

```bash
$ go env -u GOFLAGS
$ go build -mod=vendor ./...
```

Auditing tip: `go env GOFLAGS` and `go env -json` show the effective config — diff between local and CI early.

---

## Bug 17 — Symlinks inside `vendor/`

```bash
$ ls -l vendor/github.com/ourcorp/
lrwxr-xr-x  shared -> /Users/me/code/shared
```

```bash
# Windows CI
> go build ./...
vendor\github.com\ourcorp\shared: The system cannot find the file specified
```

**Bug:** A custom build script created a symlink inside `vendor/` to point at a sibling repo. It works on macOS/Linux. Windows can read symlinks only with elevated privileges, and `git` on Windows often clones symlinks as plain text files. The Windows build cannot find the dep.

**Fix:** never put symlinks under `vendor/`. Use `replace` in `go.mod` for local paths:

```go.mod
replace github.com/ourcorp/shared => ../shared
```

Then `go mod vendor` will copy real files, not links. To find existing symlinks:

```bash
$ find vendor -type l
$ # remove and re-vendor
$ find vendor -type l -delete
$ go mod vendor
```

---

## Bug 18 — Manual `git rm` of "unused" vendored files

```bash
$ git rm vendor/github.com/foo/bar/internal/legacy.go
$ git commit -m "Clean up unused vendored file"
$ go build ./...
vendor/github.com/foo/bar/internal/legacy.go: file referenced from
modules.txt but missing
```

**Bug:** Someone audited the diff, decided `legacy.go` "looked unused," and deleted it. But `go mod vendor` already pruned everything that was truly unused — what remains is part of the dep's package surface. `vendor/modules.txt` still lists the package, so the toolchain expects all its files to be present. The vendor consistency check fails.

**Fix:** never edit `vendor/` by hand. Either accept the file or re-vendor:

```bash
$ git checkout vendor
$ go mod vendor   # if you want to sync to current go.mod
```

If you genuinely want a smaller vendor tree, drop the upstream import and `go mod tidy` will remove the dep.

---

## Bug 19 — Vendoring a private module without `GOPRIVATE`

```bash
$ go mod vendor
verifying git.acme.internal/team/utils@v1.2.0: checksum database lookup
required for non-public module
go: git.acme.internal/team/utils@v1.2.0: reading
https://proxy.golang.org/git.acme.internal/team/utils/@v/v1.2.0.info:
410 Gone
```

**Bug:** `go mod vendor` calls into the same module-fetching machinery as `go get`. Without `GOPRIVATE`, it goes through the public proxy and the public checksum DB, neither of which can see internal hosts.

**Fix:** mark the internal namespace as private *before* vendoring:

```bash
$ go env -w GOPRIVATE='git.acme.internal,*.acme.internal'
$ go mod vendor
```

For CI, set the same in the workflow env:

```yaml
env:
  GOPRIVATE: git.acme.internal,*.acme.internal
```

Make sure the CI runner has SSH/HTTPS auth to the internal git host — vendor still needs to clone modules the first time.

---

## Bug 20 — Off-by-one line in hand-edited `modules.txt`

```text
# vendor/modules.txt (hand-edited to "fix" a typo)
# github.com/foo/bar v1.0.0
## explicit; go 1.20
github.com/foo/bar
github.com/foo/bar/internal/util
# github.com/baz/qux v0.5.0
## explicit
github.com/baz/qux
```

```bash
$ go build ./...
go: inconsistent vendoring: parsing vendor/modules.txt:
	line 5: unrecognized verb "github.com/foo/bar/internal/util"
```

**Bug:** Someone deleted a blank line or a `## explicit` marker, shifting subsequent entries. The parser is strict — every package line must follow a module header, every module header must be followed by markers in a fixed order. The "fix" corrupted the file.

**Fix:** never hand-edit `modules.txt`. Regenerate:

```bash
$ go mod vendor
$ git diff vendor/modules.txt
```

If you need to understand why an entry exists, `go mod why github.com/foo/bar` or `go mod graph | grep bar` is the right tool — not editing the manifest.

---

## Bug 21 — Retracted version sitting in `vendor/`

```go.mod
require github.com/foo/bar v1.4.0
```

```text
# upstream go.mod
retract v1.4.0   // critical bug
```

```bash
$ go mod tidy
go: warning: github.com/foo/bar@v1.4.0: retracted by module author:
	critical bug
go: to switch to the latest unretracted version, run:
	go get github.com/foo/bar@latest
$ go build ./...    # still builds; vendor still has v1.4.0
```

**Bug:** `go mod tidy` warns about a retracted version but does not change `go.mod` automatically. `go mod vendor` happily copies the retracted code. Builds keep using a known-broken release because vendor pinned it.

**Fix:** treat retraction warnings as errors. Move to the latest unretracted version, then re-vendor:

```bash
$ go get github.com/foo/bar@latest
$ go mod tidy
$ go mod vendor
$ git diff go.mod
```

Add `go list -m -u -retracted all` to a periodic CI job so you find retractions before users do.

---

## Bug 22 — Long-lived branch carries CVE forward

```bash
$ git checkout feature/long-running-branch
$ git log --oneline vendor/ | head
abc1234 vendor: bump golang.org/x/net to v0.7.0
$ # main, meanwhile, has v0.17.0 with a CVE fix
$ git merge main      # no conflicts in vendor/ because feature branch "wins"
$ go build ./...      # builds with the VULNERABLE v0.7.0
```

**Bug:** A branch that has been alive for months contains an old, vulnerable `vendor/` tree. When merged back to `main`, git often resolves vendor diffs with the *branch's* version (especially if the branch touched those files later). The merge silently regresses the dep — the CVE is back in production.

**Fix:** treat `vendor/` as derived state, not source. Re-vendor at every merge boundary:

```bash
$ git checkout feature/long-running-branch
$ git merge main
$ go mod tidy
$ go mod vendor          # rebuild vendor from the merged go.mod
$ git add go.mod go.sum vendor
$ git commit -m "Re-vendor after merge with main"
```

CI should refuse merges that change `go.mod` without a corresponding consistent `vendor/`:

```bash
$ go mod vendor
$ git diff --exit-code vendor go.mod go.sum || {
    echo "vendor out of sync after merge"; exit 1;
}
```

Also run `govulncheck ./...` post-merge to catch any vulnerable versions a stale vendor would otherwise hide.

---

## Summary

`vendor/` looks like just another directory on disk, but it is a derived artifact with strict consistency rules. Most vendoring bugs come from one of three habits:

1. **Treating `vendor/` as editable.** Hand-edits to `modules.txt`, source files, or even "obviously unused" files break the consistency check. Always regenerate with `go mod vendor`; never patch in place.
2. **Forgetting that `vendor/` is downstream of `go.mod`.** Every `go get`, `go mod tidy`, branch merge, or `replace` change must be followed by `go mod vendor` and committed atomically with the `go.mod` change. CI should diff `vendor/` after `go mod vendor` and fail on drift.
3. **Letting other modes override vendor silently.** `go.work`, `GOFLAGS=-mod=mod`, `-mod=mod` in CI, retracted versions, or local-path `replace` directives all bypass or pollute the vendored tree. Pin `-mod=vendor` (or rely on the auto-detect) and disable workspaces in CI.

Treat `vendor/` as compiled output that just happens to live in your repo: regenerated by tooling, reviewed for changes, never hand-massaged. With those three habits the rest of vendoring becomes invisible.
