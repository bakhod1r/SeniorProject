# go version — Find the Bug

Each scenario looks fine but misbehaves. Find the defect, explain it, fix it.

---

## Bug 1 — Reported version isn't the one installed

```bash
$ # installed go1.21.0
$ go version
go version go1.23.1 linux/amd64       # confusing!
```

**Bug:** the project's `go.mod` requires a newer version and `GOTOOLCHAIN=auto` auto-downloaded and re-exec'd go1.23.1.
**Fix:** not a bug per se — understand toolchain selection. To force the installed one: `GOTOOLCHAIN=local go version` (which will error if too old).

---

## Bug 2 — Auto-download fails in air-gapped CI

```
go: downloading go1.23.1 (linux/amd64)
go: ... dial tcp: lookup proxy.golang.org: no such host
```

**Bug:** `GOTOOLCHAIN=auto` tried to download a toolchain, but the CI environment has no network.
**Fix:** set `GOTOOLCHAIN=local` and pre-provision the required toolchain, or mirror toolchain modules through a private `GOPROXY`.

---

## Bug 3 — `go version <bin>` mistaken for platform

```bash
$ GOOS=windows GOARCH=amd64 go build -o app.exe .
$ go version app.exe
app.exe: go1.23.0      # where's "windows/amd64"?
```

**Bug:** `go version <binary>` reports the Go version, not the target OS/arch.
**Fix:** use `file app.exe` for the platform; `go version` only reports the Go toolchain version.

---

## Bug 4 — Dirty-tree release artifact

```bash
$ go version -m dist/app | grep vcs.modified
	build	vcs.modified=true
```

**Bug:** the release binary was built from a tree with uncommitted changes — provenance is compromised.
**Fix:** build releases from a clean, tagged commit; reject artifacts with `vcs.modified=true` in the release gate.

---

## Bug 5 — Team builds differ subtly

Two engineers produce different binaries from the same commit; one is on go1.22, the other go1.23.

**Bug:** no pinned toolchain, so different Go versions produced different codegen (and gofmt output).
**Fix:** pin `toolchain goX.Y.Z` in `go.mod` and align `GOTOOLCHAIN`/CI image; assert the version in CI.

---

## Bug 6 — `go.mod` go directive too new for the toolchain

```
go: go.mod requires go >= 1.23 (running go 1.21; GOTOOLCHAIN=local)
```

**Bug:** the `go` directive requires a newer version than installed, and `GOTOOLCHAIN=local` forbids downloading.
**Fix:** install/provision go1.23, or set `GOTOOLCHAIN=auto` to let it download, or lower the directive if the new features are not needed.

---

## Bug 7 — Disabling sum verification to "fix" auto-download

```bash
export GONOSUMCHECK=1   # to make toolchain download "work"
```

**Bug:** disabling checksum verification to satisfy auto-download removes supply-chain protection for the toolchain itself.
**Fix:** keep verification on; mirror toolchain modules through a trusted private `GOPROXY` instead of disabling sums.

---

## Bug 8 — Bug report without version context

A teammate reports "the build is broken" with no `go version`.

**Bug:** Go behavior is version- and platform-specific; without `go version`/`go env` the issue is unreproducible.
**Fix:** require `go version` and `go env GOOS GOARCH GOTOOLCHAIN` in the report; add it to the issue template.

---

## Bug 9 — Assuming stripped binaries hide the version

```bash
go build -ldflags="-s -w" -o app .
go version -m app    # still shows go1.23.0 and deps
```

A developer expected `-s -w` to remove the version/manifest.

**Bug:** `-s -w` strip symbol/DWARF info but BuildInfo (version, modules, VCS) remains readable.
**Fix:** if you must remove it, that requires extra steps; do not rely on stripping for hiding provenance — and usually you *want* it for auditing.

---

## How to approach these
1. Version surprising? → toolchain auto-selection; check `GOTOOLCHAIN` and the directives.
2. Download fails? → `local` + provisioned toolchain or a private proxy.
3. Want the platform? → use `file`, not `go version`.
4. Builds differ? → pin the toolchain.
5. Auditing a binary? → `go version -m` (it survives stripping).
