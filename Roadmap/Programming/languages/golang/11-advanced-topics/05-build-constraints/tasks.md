# Build Constraints — Hands-on Tasks

Work through these in order. Use Go 1.21+.

---

## Task 1: First constraint

Create a package with two files: `name_linux.go` (`func Name() string { return "linux" }`) and `name_other.go` (`//go:build !linux`).

**Acceptance criteria**
- [ ] `go run .` prints "linux" on Linux and "other" elsewhere.
- [ ] `go list -e -f '{{.GoFiles}}' .` shows the correct file.

---

## Task 2: Custom tag

Add a `debug.go` file with `//go:build debug` that exports `var DebugMode = true`. The other file has `var DebugMode = false`.

**Acceptance criteria**
- [ ] `go run .` reports `DebugMode=false`.
- [ ] `go run -tags=debug .` reports `DebugMode=true`.
- [ ] You explain why this is different from a runtime check.

---

## Task 3: Partition test

Create three platform files for `linux`, `darwin`, `windows`. Verify on each platform with `go build`.

**Acceptance criteria**
- [ ] All three compile cleanly on their target.
- [ ] Cross-compile to all three from your host (`GOOS=... go build`).
- [ ] You add a `not_supported.go` file with `//go:build !linux && !darwin && !windows` returning `"unsupported"` for other OSes.

---

## Task 4: Integration test gate

Create `mypkg_test.go` (unit tests) and `mypkg_integration_test.go` with `//go:build integration` (tests that require a real DB).

**Acceptance criteria**
- [ ] `go test ./...` runs only unit tests.
- [ ] `go test -tags=integration ./...` runs both.
- [ ] You document the conventions in a `TESTING.md`.

---

## Task 5: Pure-Go vs cgo

Create a package with two implementations of `hash(b []byte) []byte`: one using cgo, one pure Go.

**Acceptance criteria**
- [ ] `go build -tags=purego` uses the pure-Go path.
- [ ] `go build` uses cgo when `CGO_ENABLED=1`.
- [ ] Bench both and report the difference.

---

## Task 6: Go-version gate

Use `slices.SortFunc` for Go 1.21+ and a hand-rolled sort for older versions.

**Acceptance criteria**
- [ ] Two files with `//go:build go1.21` and `//go:build !go1.21`.
- [ ] Both files compile when their respective version is in use.
- [ ] Tests pass under both versions (use a Go 1.20 sandbox if available).

---

## Task 7: `unix` meta-tag

Create a `signal_unix.go` (uses `syscall.SIGTERM`) and `signal_other.go`.

**Acceptance criteria**
- [ ] `//go:build unix` is used in the unix file.
- [ ] On Windows, the "other" file is compiled.
- [ ] You confirm by setting `GOOS=windows`.

---

## Task 8: Static binary

Build your project as a fully static binary.

**Acceptance criteria**
- [ ] `CGO_ENABLED=0 go build -tags='netgo,osusergo' -ldflags='-s -w' .`
- [ ] `file ./binary` reports "statically linked" (on Linux).
- [ ] Binary size with and without `-ldflags='-s -w'` differs by ≥10%.

---

## Task 9: Cross-compilation matrix

Build for at least 6 (`GOOS`, `GOARCH`) combinations.

**Acceptance criteria**
- [ ] Combinations: linux/amd64, linux/arm64, darwin/amd64, darwin/arm64, windows/amd64, windows/arm64.
- [ ] All succeed.
- [ ] You list the resulting binary sizes.

---

## Task 10: SIMD-fast path

For one operation (sum of float64 slice, byte-counting, anything), write an amd64 implementation in Go assembly and a portable Go fallback.

**Acceptance criteria**
- [ ] `//go:build amd64` selects the assembly version.
- [ ] `//go:build !amd64` selects the Go version.
- [ ] Bench shows speedup on amd64.
- [ ] Both versions are tested for correctness with the same input.

---

## Task 11: Verify ignored files

Add a file with a deliberate typo: `//go:build linxu`.

**Acceptance criteria**
- [ ] `go list -e -f '{{.IgnoredGoFiles}}' .` lists the file.
- [ ] You fix the typo and confirm the file is now in `.GoFiles`.

---

## Task 12: CI matrix locally

Write a shell script that runs `go vet` and `go test` for every (`GOOS`, `GOARCH`) you support.

**Acceptance criteria**
- [ ] Script runs cleanly on a sample project.
- [ ] If you introduce a tag bug (e.g., remove a file's constraint), the script catches it on the wrong platform.
- [ ] You commit the script to the repo.

---

## Stretch — Task 13: Build tag CI gate

Add a CI check that asserts your project's tag conventions:

- The pure-Go and cgo files must form a partition.
- The default build must produce a static binary.
- The integration tag must enable extra tests.

**Acceptance criteria**
- [ ] CI passes on a clean repo.
- [ ] If you delete the pure-Go fallback, CI fails with a clear error.
- [ ] If a release tag is missing from the binary metadata, CI fails.

---

## Submission

Code + brief writeup per task. The goal: confident, well-documented use of build constraints in a multi-platform Go project.
