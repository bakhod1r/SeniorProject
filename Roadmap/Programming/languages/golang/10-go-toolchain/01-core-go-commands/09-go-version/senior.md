# go version — Senior

## 1. The toolchain selection model (Go 1.21+)

Since Go 1.21, the `go` command is a *toolchain launcher* as much as a build tool. When you run any `go` command, it decides which toolchain to actually execute based on:

1. `GOTOOLCHAIN` environment/`go env -w` setting.
2. The `toolchain` directive in `go.mod`/`go.work`.
3. The `go` directive (minimum version).

With `GOTOOLCHAIN=auto` (the default), if the required version exceeds the installed one, the `go` command **downloads the newer toolchain** (as a special module from the toolchain repository, verified via the sum DB) and re-execs itself with it. So `go version` can report a version you never explicitly installed.

```bash
go env GOTOOLCHAIN
go version              # may be the auto-selected toolchain, not the bootstrap one
```

This is the single most important senior insight: **the version that runs is computed, not fixed.**

---

## 2. `go version -m` as a provenance and security tool

`go version -m <binary>` exposes the embedded `BuildInfo`:

```bash
go version -m ./app
```

Senior uses:
- **Vulnerability triage:** confirm which dependency versions actually shipped, then cross-check with `govulncheck` (which itself reads BuildInfo from binaries).
- **Provenance:** `vcs.revision`/`vcs.time`/`vcs.modified` tell you the exact commit and whether the tree was dirty at build time.
- **Build settings:** verify `-trimpath`, `CGO_ENABLED`, `GOOS/GOARCH`-relevant flags were applied to a release.

```bash
govulncheck -mode=binary ./app    # scans the binary's embedded module versions
```

This works on any Go binary, including ones built elsewhere — invaluable for auditing artifacts you did not build.

---

## 3. Version comparison and ordering

Go versions follow `goMAJOR.MINOR.PATCH` with the quirk that the *language* version is `1.MINOR` and the toolchain adds patch releases. Pre-1.21, the `go` directive was `1.21` style (no patch); since 1.21 it can include a patch (`1.21.0`). Seniors watch:

- `go 1.21` and `go 1.21.0` are not identical in directive semantics (the latter pins a patch).
- Comparisons use the `golang.org/x/mod/semver`-style ordering for module versions, but toolchain versions are ordered by their numeric components.
- A `go` directive newer than your toolchain triggers either an auto-download (`auto`) or an error (`local`).

---

## 4. Reproducibility hinges on the toolchain

Two builds are only byte-identical if, among other things, they used the **same toolchain version**. Therefore:

- Pin the `toolchain` directive so everyone (and CI) builds with the same version.
- Set `GOTOOLCHAIN` deliberately: `auto` for convenience, `local` (with a managed install) for strict control in locked-down environments.
- `go version` on the CI runner should match what the `toolchain` directive selects; mismatches produce subtly different binaries and even different gofmt output.

```bash
# CI: prove the active toolchain matches expectations
go version
go env GOTOOLCHAIN
```

---

## 5. Where it surprises people

- **Auto-download.** `GOTOOLCHAIN=auto` silently fetches a newer toolchain; in air-gapped/locked CI this fails or is undesirable. Set `local` or pre-provision the version.
- **Reported version ≠ installed version.** People are confused when `go version` shows 1.23 after installing 1.21 — auto-selection did it.
- **`go version <bin>` shows only the Go version**, not the target platform; use `file` for OS/arch.
- **Stripped binaries still report version.** `-ldflags="-s -w"` strips symbols but the Go version/BuildInfo remains readable by `go version -m` (unless explicitly cleared).
- **`vcs.modified=true`** in a release binary signals a dirty build — a provenance red flag.
- **GOFLAGS does not affect `go version`'s report**, but the toolchain selection does.

---

## 6. Managing multiple toolchains

```bash
# install a specific toolchain as a command (Go 1.21+ mechanism)
go install golang.org/dl/go1.22.5@latest
go1.22.5 download
go1.22.5 version

# or let GOTOOLCHAIN fetch on demand
GOTOOLCHAIN=go1.22.5 go build ./...
```

The `golang.org/dl/goX.Y.Z` wrappers and `GOTOOLCHAIN=goX.Y.Z` both let you run a specific version without changing your default install. Seniors use these to test a change against multiple Go versions.

---

## 7. CI usage

```bash
# fail early if the toolchain is not what we expect
expected=go1.23.1
got=$(go version | awk '{print $3}')
[ "$got" = "$expected" ] || { echo "toolchain mismatch: $got != $expected"; exit 1; }

# audit a built artifact
go version -m dist/app | grep -E 'vcs\.|-trimpath|CGO_ENABLED'
```

CI rules:
- Pin the toolchain (directive + `GOTOOLCHAIN`) and assert it.
- Decide `auto` vs `local` based on whether your CI can/should download toolchains.
- Use `go version -m` (and `govulncheck -mode=binary`) to audit release artifacts.

---

## 8. Summary

Since Go 1.21 the `go` command computes which toolchain to run from `GOTOOLCHAIN`, the `toolchain` directive, and the `go` directive — so `go version` may report a version you never installed (auto-download). `go version -m` exposes the embedded BuildInfo (module versions, build flags, VCS provenance) for any binary, making it a key security/audit tool (pair with `govulncheck -mode=binary`). Reproducibility requires pinning the toolchain; choose `auto` for convenience or `local` for locked-down control, and assert the active version in CI.

---

## Further reading
- Go toolchains: https://go.dev/doc/toolchain
- `go version -m` / BuildInfo: https://pkg.go.dev/runtime/debug#ReadBuildInfo
- `govulncheck` binary mode: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
