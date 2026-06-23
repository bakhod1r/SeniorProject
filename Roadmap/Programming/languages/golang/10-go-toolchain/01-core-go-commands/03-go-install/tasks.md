# go install — Hands-on Tasks

Go 1.21+. Each task has explicit acceptance criteria.

---

## Task 1: PATH setup

Make installed tools runnable.

**Acceptance criteria**
- [ ] `go env GOPATH` and `go env GOBIN` print their values.
- [ ] You add the correct bin directory to `PATH` in your shell profile.
- [ ] A new shell can find binaries from that directory.

---

## Task 2: Install your own command

Init a module with a `main` and install it.

**Acceptance criteria**
- [ ] `go install .` succeeds.
- [ ] Running the command by name (no path) from a different directory works.
- [ ] The binary exists in your bin directory with the directory's name.

---

## Task 3: Install a remote tool

Install a versioned third-party tool.

**Acceptance criteria**
- [ ] `go install honnef.co/go/tools/cmd/staticcheck@v0.5.1` succeeds.
- [ ] `staticcheck -version` (or `--version`) runs.
- [ ] `go version -m "$(go env GOPATH)/bin/staticcheck"` shows version `v0.5.1`.
- [ ] Your project's `go.mod` is unchanged (`git diff go.mod` empty).

---

## Task 4: latest vs pinned

Observe the difference.

**Acceptance criteria**
- [ ] `go install <tool>@latest` resolves the newest version (note network activity).
- [ ] `go install <tool>@<exactversion>` is reproducible and cached on the second run.
- [ ] You write one sentence on why CI should pin versions.

---

## Task 5: Install with build stamping

Stamp a version into your own tool.

**Acceptance criteria**
- [ ] `go install -ldflags="-X main.version=1.0.0" .` installs the binary.
- [ ] Running it shows `1.0.0`.
- [ ] `go version -m <binary>` reflects the build settings.

---

## Task 6: Cross-arch install location

See where cross installs go.

**Acceptance criteria**
- [ ] `GOOS=linux GOARCH=arm64 go install .` succeeds.
- [ ] The binary appears under `$GOPATH/bin/linux_arm64/`, not directly in `bin/`.
- [ ] You can explain why Go separates it.

---

## Task 7: Install all commands in a repo

Use the `./cmd/...` pattern.

**Acceptance criteria**
- [ ] A repo with two `cmd/<name>` directories installs both via `go install ./cmd/...`.
- [ ] Both binaries appear in the bin directory with their respective names.

---

## Task 8: tool directive (Go 1.24+)

If on Go 1.24+, track a tool in `go.mod`.

**Acceptance criteria**
- [ ] `go get -tool honnef.co/go/tools/cmd/staticcheck` adds a `tool` line to `go.mod`.
- [ ] `go tool staticcheck ./...` runs the pinned tool.
- [ ] You explain how this prevents team version drift.
