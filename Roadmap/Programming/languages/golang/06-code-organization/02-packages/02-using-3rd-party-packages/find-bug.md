# Using Third-Party Packages — Find the Bug

> Each snippet contains a real-world bug related to depending on third-party Go packages. Find it, explain it, fix it.

---

## Bug 1 — `go get pkg` to install a CLI

```bash
$ go get github.com/golangci/golangci-lint/cmd/golangci-lint
go: 'go get' is no longer supported outside a module
        (or in legacy GOPATH mode); see 'go help get'
```

Or, inside a module:

```bash
$ go get github.com/golangci/golangci-lint/cmd/golangci-lint@latest
$ which golangci-lint
golangci-lint not found
```

**Bug:** since Go 1.17, `go get` only updates `go.mod` — it does not install binaries. Since 1.18 it stopped working outside a module entirely. To install a CLI you must use `go install pkg@version`.

**Fix:**

```bash
$ go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
```

`go install` writes the binary to `$GOBIN` (or `$GOPATH/bin`). If you want the dependency tracked in `go.mod` *and* a local binary, do both — they are different operations.

---

## Bug 2 — Importing v1 path while requiring v2

```go.mod
require github.com/foo/bar/v2 v2.3.1
```

```go
import "github.com/foo/bar"
```

```bash
$ go build
main.go:5:8: no required module provides package github.com/foo/bar
```

**Bug:** Semantic Import Versioning encodes the major version in the import path. `v2+` of a module lives at `.../v2`, not the original path. The require and the import disagree, so `go` cannot find the package.

**Fix:** update every import site to the suffixed path:

```go
import bar "github.com/foo/bar/v2"
```

Then `go mod tidy`. Use `gofmt -r` or `gopls rename` to migrate aliases sanely.

---

## Bug 3 — Pseudo-version pinned to a force-pushed commit

```go.mod
require github.com/acme/exp v0.0.0-20240601121314-abc123def456
```

```bash
$ go build
go: github.com/acme/exp@v0.0.0-20240601121314-abc123def456:
        invalid version: unknown revision abc123def456
```

**Bug:** the dep was pinned to a pseudo-version computed from a feature branch. The upstream maintainer force-pushed (or rebased) and the SHA no longer exists. The proxy cache eventually evicts it and the build dies.

**Fix:** pin to a tag or a commit on a stable branch, never a transient one. If you must depend on unreleased code, vendor it or fork:

```bash
$ go get github.com/acme/exp@v0.4.0
```

If the original SHA is still in the module proxy, you can also `go mod download github.com/acme/exp@<sha>` while you migrate.

---

## Bug 4 — Hand-edited `go.sum`

```bash
$ go build
verifying github.com/spf13/cobra@v1.8.1: checksum mismatch
        downloaded: h1:abcd...
        go.sum:     h1:zzzz...

SECURITY ERROR
This download does NOT match an earlier download recorded in go.sum.
```

**Bug:** somebody opened `go.sum` in a text editor to "resolve a merge conflict" or "tidy up" duplicates. `go.sum` is integrity-checked; a single byte change converts a real hash mismatch into a security error.

**Fix:** never edit `go.sum`. Restore from git and let the toolchain regenerate:

```bash
$ git checkout -- go.sum
$ go mod tidy
```

If a real conflict happened during a merge, accept either side, then re-run `go mod tidy` and commit the result.

---

## Bug 5 — `replace` pointing at the wrong sibling path

```go.mod
require github.com/me/shared v0.1.0

replace github.com/me/shared => ../shared-lib
```

```bash
$ ls ..
api  shared
$ go build
go: github.com/me/shared@v0.0.0-00010101000000-000000000000
        (replaced by ../shared-lib): reading ../shared-lib/go.mod:
        open ../shared-lib/go.mod: no such file or directory
```

**Bug:** the directory is `../shared`, not `../shared-lib`. Local-path replaces are silently relative to the **directory containing `go.mod`**, and a typo here turns into a confusing error message.

**Fix:**

```go.mod
replace github.com/me/shared => ../shared
```

Better: move local-only `replace` into a `go.work` file at the monorepo root so it is not committed inside `go.mod`.

---

## Bug 6 — Dep requires a newer Go than your toolchain

```go.mod
go 1.20

require github.com/cool/lib v1.0.0
```

```bash
$ go build
go: github.com/cool/lib@v1.0.0 requires go >= 1.22
        (running go 1.20.5; GOTOOLCHAIN=local)
```

**Bug:** `cool/lib v1.0.0` declared `go 1.22` in *its* `go.mod`. Since Go 1.21, the `go` directive is enforced as a minimum, not a hint. Your toolchain is older.

**Fix:** raise your floor and let Go auto-download a newer toolchain:

```go.mod
go 1.22

toolchain go1.22.5
```

If you cannot upgrade (for example, an old Linux kernel), pin to a version of the dep that supported your toolchain (`go get github.com/cool/lib@v0.9.0`) and document why.

---

## Bug 7 — Two majors of the same dep coexisting

```bash
$ go list -m all | grep prometheus
github.com/prometheus/client_golang v1.16.0
github.com/prometheus/client_golang/v2 v2.0.0-rc.1
```

```bash
$ go build
runtime error: registering duplicate metric "go_goroutines"
```

**Bug:** your direct deps require different majors of the same library. Both end up in the binary. Code that uses package-level state (registries, init-side-effects, type identity) sees the world double — at best you get bloat, at worst a panic.

**Fix:** unify the major. Find which dep dragged in the second major:

```bash
$ go mod why -m github.com/prometheus/client_golang/v2
$ go mod graph | grep client_golang
```

Upgrade or replace whichever transitive dep is stuck on the old/new major. If you genuinely need both, isolate them behind your own thin wrapper packages.

---

## Bug 8 — `govulncheck` finding ignored as "transitive"

```bash
$ govulncheck ./...
Vulnerability #1: GO-2024-2961
  Affected: stdlib
  ...
  Found in: github.com/cool/lib@v1.5.0 → golang.org/x/net@v0.20.0
  Fixed in: golang.org/x/net@v0.23.0

Standard library
Found Go vulnerabilities, but the affected functions are only reachable
from imported packages, not your code. Consider this resolved.
```

**Bug:** the team treated "only reachable from imported packages" as "not our problem". `govulncheck` reports *call-graph reachability* — a vuln that fires only when the imported library calls it is still your vuln if your code calls that library. The note above does **not** mean the vuln is unreachable.

**Fix:** read the report fully. If `govulncheck` says a vulnerable function is reachable, upgrade the transitive dep:

```bash
$ go get golang.org/x/net@v0.23.0
$ go mod tidy
$ govulncheck ./...
```

If a transitive dep blocks the upgrade, force it via `require` or open an upstream issue. Track all suppressions in code review, not in your head.

---

## Bug 9 — Minor bump of a v0 library breaks API

```bash
$ go get github.com/some/lib@v0.5.0   # was v0.4.0
$ go build
./main.go:42: cannot use cfg (type *Config) as type Options in argument to Init
```

**Bug:** Semver promises stability for `v1+`. For `v0.x.y`, anything goes — including silent breaking changes between `v0.4.0` and `v0.5.0`. The library is honest by staying in `v0`; the team treated minor bumps as safe.

**Fix:** treat `v0` as "every bump is potentially breaking":

```bash
$ go get github.com/some/lib@v0.4.0   # roll back
```

Pin v0 deps tightly in `go.mod`, read release notes before upgrading, and add a CI step that runs `go test ./...` with race detection after every bump.

---

## Bug 10 — Blank import for a deprecated driver

```go
import (
    _ "github.com/lib/pq"
)
```

```bash
$ go run .
sql: unknown driver "postgres" (forgotten import?)
```

**Bug:** the team upgraded `lib/pq` to a version where the maintainers stopped registering the `"postgres"` driver name in `init()` (or removed the package entirely after deprecation in favour of `pgx`). The blank import compiles but does nothing.

**Fix:** migrate to a maintained driver and use `database/sql` with the new name, or use `pgx` natively:

```go
import (
    _ "github.com/jackc/pgx/v5/stdlib"
)

db, err := sql.Open("pgx", dsn)
```

In general, audit blank imports during library upgrades — they are invisible at the call site and easy to break silently.

---

## Bug 11 — GPL dep in an Apache project

```go.mod
require github.com/some/gpl-lib v1.0.0
```

```
LICENSE: Apache-2.0
github.com/some/gpl-lib LICENSE: GPL-3.0
```

**Bug:** GPL-3.0 imposes copyleft on derivative works. Linking it into an Apache-2.0 binary forces the whole binary under GPL terms — incompatible with what your project promises consumers. Most companies' legal teams ban this outright.

**Fix:** replace the dep, fork it under a permissive license if the maintainer allows, or wrap it as a separate process and call it via IPC (still risky — talk to legal). Add a license-scanning step to CI:

```bash
$ go-licenses check ./...
```

or `licensee`, `fossa`, `trivy fs`. Fail the build on incompatible licenses.

---

## Bug 12 — Typosquatted dep from a blog post

```go
import "github.com/jackc/pgxx/v5"   // copied from a tutorial
```

```bash
$ go mod tidy
$ go build
$ ./app
panic: pgxx: connecting to ftp.attacker.example: ...
```

**Bug:** the real package is `github.com/jackc/pgx/v5`. A typosquatter registered `pgxx` and shipped a malicious `init()`. Copy-pasting from a screenshot or blog skipped the manual verification step.

**Fix:** delete it immediately, rotate any secrets the binary touched, and add a guard in CI:

```bash
$ go mod edit -droprequire=github.com/jackc/pgxx/v5
$ go get github.com/jackc/pgx/v5
$ go mod tidy
```

Treat new dependencies like you would treat new contractors: verify the namespace, the maintainer, the star/fork pattern, and the release history. Tools like `osv-scanner` and `deps.dev` flag known typosquats.

---

## Bug 13 — Module renamed upstream

```bash
$ go mod tidy
go: github.com/old-org/cool-lib@v1.4.0: reading
        https://proxy.golang.org/github.com/old-org/cool-lib/@v/v1.4.0.info:
        404 Not Found
```

**Bug:** the upstream repo was transferred to `new-org/cool-lib` and the old one was deleted. The proxy still has cached versions, but new ones never appear, and a clean cache is a 404. Pull requests and CI break for everyone who cleared `GOMODCACHE`.

**Fix:** find the new home and migrate imports:

```bash
$ go mod edit -replace=github.com/old-org/cool-lib=github.com/new-org/cool-lib@v1.5.0
$ go mod tidy
```

Once you've updated all import paths in source, drop the `replace` and `require` the new path directly. If upstream offers a redirect via `go-import` meta tags, prefer that.

---

## Bug 14 — `go get -u` broke an interface

```bash
$ go get -u ./...
$ go build
./handler.go:88: cannot use h (type *Handler) as type http.Handler
        in argument to s.Use: missing method ServeHTTPWithContext
```

**Bug:** `go get -u` upgraded *every* dep to its latest minor. One of them (a middleware library) introduced a new required interface method between minors. Now your code does not compile, and you have no idea which dep changed.

**Fix:** revert and upgrade deliberately. Keep the previous `go.sum` in git history:

```bash
$ git checkout HEAD -- go.mod go.sum
$ go mod tidy
```

Then upgrade one dep at a time:

```bash
$ go get example.com/middleware@latest
$ go test ./...
```

Avoid `go get -u ./...` outside of a "monthly upgrade" branch where breakages are expected.

---

## Bug 15 — `GOPROXY` set without `GOPRIVATE`

```bash
$ go env -w GOPROXY=https://corp-proxy.acme.io,direct
# CI:
$ go build
go: git.acme.internal/team/utils@v1.2.0:
        verifying module: checksum database lookup required for non-public module
```

**Bug:** `GOPROXY` was changed to a corporate mirror, but `GOPRIVATE` was not set, so Go still tries to verify internal modules against the public sum database. The corp proxy fronts both public and private modules, but the checksum DB will never have heard of `git.acme.internal`.

**Fix:** mark internal namespaces as private. Persist this in CI configuration, not just on developer laptops:

```bash
$ go env -w GOPRIVATE=git.acme.internal,*.acme.internal
$ go env -w GONOSUMCHECK=git.acme.internal
```

Commit a small bootstrap script (`scripts/setup-go-env.sh`) so new hires and CI agents get identical settings.

---

## Bug 16 — `replace` pointing at a developer's laptop

```go.mod
require github.com/me/shared v1.4.0

replace github.com/me/shared => /Users/alice/code/shared
```

```bash
# Bob runs:
$ go build
go: directory /Users/alice/code/shared does not exist
```

**Bug:** Alice prototyped a fix locally with an absolute path replace, then accidentally committed `go.mod`. Bob, the CI runner, and everyone else gets a broken build with a path that obviously belongs to one machine.

**Fix:** local replaces belong in `go.work`, never in committed `go.mod`. Remove it:

```bash
$ go mod edit -dropreplace=github.com/me/shared
$ go mod tidy
```

Add a CI guard:

```bash
$ grep -E '^replace .* => (/|[A-Za-z]:)' go.mod && {
    echo "Absolute-path replace in go.mod"; exit 1; }
```

---

## Bug 17 — `go mod tidy` removed a build-tagged dep

```go
//go:build linux

package agent

import "github.com/lxc/go-lxc"
```

The developer tidies on macOS:

```bash
$ go mod tidy
$ git diff go.mod
- require github.com/lxc/go-lxc v0.1.0
```

```bash
# Linux CI:
$ go build
agent_linux.go:5:8: no required module provides package github.com/lxc/go-lxc
```

**Bug:** by default `go mod tidy` only sees the build context for the current OS/arch. A dep used exclusively under `//go:build linux` looks unused on macOS and gets pruned.

**Fix:** since Go 1.17, run tidy across all relevant build contexts:

```bash
$ go mod tidy -compat=1.17
$ GOOS=linux go mod tidy
$ GOOS=windows go mod tidy
```

Or more simply, since Go 1.21:

```bash
$ go mod tidy -e
```

Best practice: make CI run `go mod tidy` for every supported `GOOS` matrix and fail if `go.mod` would change.

---

## Bug 18 — Major bump without `/v2` in the import path

A library author tags `v2.0.0`:

```go.mod
// inside lib repo
module github.com/me/awesome
```

```go
// consumer
import "github.com/me/awesome"
```

```bash
$ go get github.com/me/awesome@v2.0.0
go: github.com/me/awesome@v2.0.0: invalid version:
        module contains a go.mod file, so major version must be
        compatible: should be v0 or v1, not v2
```

Or, if the consumer used `+incompatible`:

```bash
$ go list -m all
github.com/me/awesome v2.0.0+incompatible
```

…and now half the ecosystem is on `+incompatible` and half on a proper `v2`. Any project that depends on both forms gets ambiguous-import errors.

**Fix:** library authors must change the module path to `github.com/me/awesome/v2` for `v2.0.0+`. Consumers should *never* rely on `+incompatible` — pin to a real `v2` tag once the author cuts one, or stay on `v1`.

```go.mod
// in lib
module github.com/me/awesome/v2
```

```go
// in consumer
import "github.com/me/awesome/v2"
```

---

## Bug 19 — `vendor/` out of sync after `go get`

```bash
$ go get github.com/spf13/cobra@v1.8.1
$ git diff --stat
 go.mod | 2 +-
 go.sum | 4 ++--
$ git push
# CI:
$ go build -mod=vendor
package github.com/spf13/cobra: not found in vendor/
```

**Bug:** the project uses vendoring, but `go get` only updated `go.mod`/`go.sum`. The vendored copy of `cobra` is still the old one. CI builds with `-mod=vendor` (the default once `vendor/` exists in 1.14+) and cannot find the new version.

**Fix:** always re-vendor after dep changes, and commit `vendor/` together with `go.mod`:

```bash
$ go get github.com/spf13/cobra@v1.8.1
$ go mod tidy
$ go mod vendor
$ git add go.mod go.sum vendor
$ git commit -m "Bump cobra to v1.8.1"
```

Add a CI step that runs `go mod vendor` and fails if `vendor/` is dirty:

```bash
$ go mod vendor
$ git diff --exit-code vendor go.mod go.sum
```

---

## Bug 20 — Dep's `init()` panics on missing env var

```go
import _ "github.com/some/metrics"
```

```go
// inside that dep:
func init() {
    if os.Getenv("METRICS_API_KEY") == "" {
        panic("METRICS_API_KEY is required")
    }
}
```

```
prod logs:
panic: METRICS_API_KEY is required

goroutine 1 [running]:
github.com/some/metrics.init.0()
        /go/pkg/mod/github.com/some/metrics@v1.2.0/init.go:18 +0x84
```

**Bug:** `init()` ran during binary startup. Local dev had the env var; prod did not. The team learned about it from a 3 AM page because `init()` panics kill the process before main() can log a structured error.

**Fix:** library authors should *not* panic in `init()`. As a consumer, you have two options:

1. Always set the var (and document it in your deployment manifest):
2. Wrap or fork the dep so initialisation is explicit:

```go
metrics.Init(metrics.Config{APIKey: os.Getenv("METRICS_API_KEY")})
```

Audit every blank import in your dep tree for `init()` side effects:

```bash
$ go doc -all github.com/some/metrics | grep -A2 'func init'
```

Add a startup smoke test in CI that runs the binary with `--version` against a stripped environment.

---

## Bug 21 — Transitive `cgo` breaks cross-compile

```bash
$ GOOS=linux GOARCH=arm64 go build ./cmd/agent
# github.com/some/db
exec: "aarch64-linux-gnu-gcc": executable file not found in $PATH
```

**Bug:** the team thought their code was pure Go. A new dep brought in `cgo` transitively (typically a SQLite or crypto wrapper). Cross-compiling now requires the right C toolchain, which is not on the developer's laptop.

**Fix:** find the cgo offender:

```bash
$ go list -deps -f '{{if .CgoFiles}}{{.ImportPath}}{{end}}' ./...
```

Then pick one of:

- Replace it with a pure-Go alternative (e.g. `modernc.org/sqlite` instead of `mattn/go-sqlite3`).
- Cross-compile inside Docker with the right toolchain.
- Set `CGO_ENABLED=0` and accept that the cgo-using dep cannot link — fail loudly in CI:

```bash
$ CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build ./...
```

Document the policy: "no new cgo deps without architecture review."

---

## Bug 22 — `@latest` resolved to a pre-1.0 unstable version

```bash
$ go get github.com/cool/lib@latest
$ go list -m github.com/cool/lib
github.com/cool/lib v0.0.0-20240601-abcdef123456
```

```bash
$ go build
./main.go:12: undefined: lib.NewClient
```

**Bug:** `@latest` resolves to the highest *semver* version. If the library has never tagged anything, `@latest` becomes the latest commit on the default branch — a pseudo-version with no API stability guarantees. The function name was renamed yesterday.

**Fix:** never assume `@latest` is stable. Inspect what it resolved to:

```bash
$ go list -m -versions github.com/cool/lib
github.com/cool/lib v0.1.0 v0.2.0 v0.3.0
```

Pin to a tag and read the changelog:

```bash
$ go get github.com/cool/lib@v0.3.0
$ go mod tidy
```

For libraries with no tags at all, vendor or fork — depending on a moving HEAD is not a strategy.

---

## Summary

Most third-party-dep bugs come from one of four mistakes:

1. **Confusing `go get` and `go install`.** After Go 1.17, `go get` only edits `go.mod`. Use `go install pkg@version` for binaries.
2. **Letting "local convenience" leak into committed files.** Absolute-path `replace`, hand-edited `go.sum`, or a stray `go.work` poisons every other clone of the repo.
3. **Trusting "latest" or "minor bump"-style upgrades blindly.** `v0` libraries break on minors; `@latest` can resolve to unstable HEADs; transitive cgo, init-side-effects, and license changes ride in unannounced.
4. **Skipping the audit step.** `go list -m all`, `go mod why`, `govulncheck`, `go-licenses`, and a CI `go mod tidy` diff catch nine out of ten of the bugs above before they reach production.

The Go module system is strict so that your dependency graph is reproducible. Work *with* it: edit through `go get` and `go mod`, pin deliberately, audit transitively, and treat every new import as a small contract you are signing on behalf of every future user of the binary.
