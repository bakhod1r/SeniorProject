# Build Tags — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: First `//go:build` file

Create a package with `main.go` (no constraint) and `only_linux.go` containing `//go:build linux` and a function `linuxOnly()` called from `main`.

**Acceptance criteria**
- [ ] On Linux: `go build .` succeeds and the program calls `linuxOnly()`.
- [ ] On macOS/Windows: `go build .` fails with `undefined: linuxOnly`.
- [ ] If you remove the blank line between `//go:build linux` and `package main`, the file is included everywhere — confirm this by building on a non-Linux host.

---

## Task 2: Per-OS implementations of `Notify()`

Write a `notify` package exporting `func Notify(msg string)`. Provide two files:
- `notify_unix.go` with `//go:build unix` — prints `[unix] <msg>`.
- `notify_windows.go` with `//go:build windows` — prints `[windows] <msg>`.

A `main.go` in a separate package calls `notify.Notify("hello")`.

**Acceptance criteria**
- [ ] `go build .` on macOS or Linux produces a binary that prints `[unix] hello`.
- [ ] `GOOS=windows GOARCH=amd64 go build .` produces a Windows binary (you don't have to run it).
- [ ] `go list -f '{{.GoFiles}}' ./notify` shows only one of the two files.

---

## Task 3: Custom `integration` tag

In a package `billing`, create `unit_test.go` (always compiled) and `integration_test.go` with `//go:build integration` that contains a `TestStripeReal` placeholder.

**Acceptance criteria**
- [ ] `go test ./billing` runs only the unit tests.
- [ ] `go test -tags=integration ./billing` runs both unit and integration tests.
- [ ] `go list -tags=integration -f '{{.TestGoFiles}}' ./billing` lists both files; without the flag it lists only one.

---

## Task 4: Combine constraints with `&&` and `||`

Create three files in one package:
- `fast_amd64.go` with `//go:build linux && amd64` — defines `func fast() string { return "linux/amd64" }`.
- `fast_arm.go` with `//go:build (linux || darwin) && arm64` — defines the same function returning `"arm64"`.
- `fast_other.go` with `//go:build !(linux && amd64) && !((linux || darwin) && arm64)` — defines the same function returning `"generic"`.

**Acceptance criteria**
- [ ] On any host, exactly one `fast.go` file is compiled (verify with `go list -f '{{.GoFiles}}' .`).
- [ ] The program builds and prints the expected string for your platform.
- [ ] Building for `GOOS=linux GOARCH=amd64` and `GOOS=darwin GOARCH=arm64` selects the matching file.

---

## Task 5: Migrate `// +build` to `//go:build` with `gofmt`

Create a file with **only** the legacy form:

```go
// +build linux,amd64

package mypkg
```

Run `gofmt -w .` and observe the result.

**Acceptance criteria**
- [ ] After `gofmt -w .`, the file contains both `//go:build linux && amd64` and `// +build linux,amd64`.
- [ ] If you change the `//go:build` line to disagree (e.g., `//go:build darwin`), `go vet ./...` reports a constraint mismatch.
- [ ] After deleting the `// +build` line and re-running `gofmt`, only `//go:build` remains.

---

## Task 6: Verify which files are compiled

Use `go list` to introspect the build:

**Acceptance criteria**
- [ ] `go list -f '{{.GoFiles}}' .` prints the included `.go` files for the current platform.
- [ ] `go list -f '{{.IgnoredGoFiles}}' .` prints files filtered out by constraints.
- [ ] `go list -tags=integration -f '{{.TestGoFiles}}' ./...` includes integration-tagged test files.
- [ ] You can explain in one sentence why a file you expected to see is missing from the list.

---

## Task 7: Two distinct binaries (CE vs Enterprise)

In one repo, define:
- `free.go` (always compiled) with a `Features() []string` returning `[]string{"basic"}`.
- `enterprise.go` with `//go:build enterprise` that **shadows** or **augments** the feature list to include `"sso"` and `"audit-log"` (use whatever Go pattern you prefer: separate file with a `var` initializer, or a per-build constant).

**Acceptance criteria**
- [ ] `go build -o ./bin/myapp-ce .` produces a CE binary; running it prints `[basic]`.
- [ ] `go build -tags=enterprise -o ./bin/myapp-ee .` produces an EE binary; running it prints `[basic sso audit-log]`.
- [ ] `go tool buildid ./bin/myapp-ce` and `go tool buildid ./bin/myapp-ee` return **different** IDs.
- [ ] `go version -m ./bin/myapp-ee` shows `build -tags=enterprise` in the metadata.

---

## Task 8: Pair `cgo` and `!cgo` builds

Write a package `fastmath` with two files:
- `fast_cgo.go` (`//go:build cgo`) — exports `Double(x int) int` and uses a tiny `import "C"` block (`// int double(int x) { return x*2; }` then `int(C.double(C.int(x)))`).
- `fast_nocgo.go` (`//go:build !cgo`) — exports `Double` as a pure-Go fallback.

**Acceptance criteria**
- [ ] `CGO_ENABLED=1 go build .` compiles the cgo version.
- [ ] `CGO_ENABLED=0 go build .` compiles the pure-Go version.
- [ ] `GOOS=linux GOARCH=arm64 CGO_ENABLED=0 go build .` cross-compiles successfully because the fallback exists.
- [ ] Deleting either file breaks one of the two build modes — confirm this, then restore.

---

## Task 9: Find a typo that silently disables a constraint

Create `secret_linus.go` (note: `linus`, not `linux`) with what you think is a Linux-only file. Build it on macOS.

**Acceptance criteria**
- [ ] `go build .` on macOS succeeds and the file is included (the typo means no constraint applies).
- [ ] `go list -f '{{.GoFiles}}' .` lists `secret_linus.go` even on a non-Linux host.
- [ ] Renaming the file to `secret_linux.go` now excludes it on macOS — confirm with `go list`.
- [ ] You can describe in one sentence why the typo failed silently rather than erroring.
