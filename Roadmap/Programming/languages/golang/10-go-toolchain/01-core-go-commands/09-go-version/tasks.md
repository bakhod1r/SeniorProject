# go version — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: Identify your toolchain

Report your environment.

**Acceptance criteria**
- [ ] `go version` prints `go versionX.Y.Z os/arch`.
- [ ] You can name the version, OS, and architecture from the line.
- [ ] `go env GOTOOLCHAIN` shows your toolchain policy.

---

## Task 2: Inspect a built binary

Check what built an executable.

**Acceptance criteria**
- [ ] `go build -o app .` then `go version app` prints the Go version.
- [ ] You confirm the version matches `go version`.

---

## Task 3: Read the build manifest

Use `-m`.

**Acceptance criteria**
- [ ] `go version -m app` lists `mod`/`dep` entries and `build` settings.
- [ ] Building with `-trimpath` makes that appear under `build`.
- [ ] From a clean git tree, `vcs.modified=false` appears; from a dirty tree, `true`.

---

## Task 4: Distinguish toolchain from the go directive

Compare the two version concepts.

**Acceptance criteria**
- [ ] You set `go 1.22` in `go.mod` and explain it is the minimum, not the installed version.
- [ ] You explain when a `go` directive newer than your toolchain triggers an action.

---

## Task 5: Toolchain selection

Experiment with GOTOOLCHAIN.

**Acceptance criteria**
- [ ] Adding `toolchain go1.XX.Y` (a version you have) and running `go version` reflects the selection logic.
- [ ] `GOTOOLCHAIN=local go version` uses the installed toolchain.
- [ ] You explain what `GOTOOLCHAIN=auto` would do if the directive required a newer version.

---

## Task 6: Run a specific version

Install and use an alternate toolchain.

**Acceptance criteria**
- [ ] `go install golang.org/dl/go1.22.5@latest && go1.22.5 download` works (network required).
- [ ] `go1.22.5 version` reports that exact version.
- [ ] Your default `go version` is unchanged.

---

## Task 7: Audit a binary for provenance

Treat `-m` as an ops tool.

**Acceptance criteria**
- [ ] `go version -m app | grep vcs.revision` shows the commit.
- [ ] You identify a dependency version from the `dep` lines.
- [ ] You optionally run `govulncheck -mode=binary app` to scan the embedded versions.

---

## Task 8: CI toolchain assertion (reflection)

Write a check that enforces a version.

**Acceptance criteria**
- [ ] A script compares `go version | awk '{print $3}'` to an expected value and exits non-zero on mismatch.
- [ ] You write 2 sentences on why version consistency matters for reproducible builds.
