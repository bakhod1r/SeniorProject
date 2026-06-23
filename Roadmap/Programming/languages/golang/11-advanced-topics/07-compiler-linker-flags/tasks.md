# Compiler & Linker Flags — Hands-on Tasks

Work through these in order. Go 1.21+.

---

## Task 1: Strip a binary

Build a simple "hello world" program twice: once with default flags, once with `-ldflags='-s -w'`.

**Acceptance criteria**
- [ ] Both binaries produce the same output.
- [ ] Stripped version is ≥10% smaller.
- [ ] You note the file sizes.

---

## Task 2: Inject a version

Add `var version = "dev"` to your main package. Build with `-ldflags="-X main.version=v1.0.0"`.

**Acceptance criteria**
- [ ] Running the program prints "v1.0.0".
- [ ] Running without the flag prints "dev".
- [ ] You try injecting into a `const` and observe that it doesn't work.

---

## Task 3: Buildinfo package

Create `pkg/buildinfo/buildinfo.go` with `Version`, `GitCommit`, `BuildTime`. Inject all three via `-ldflags`.

**Acceptance criteria**
- [ ] All three values are settable from the command line.
- [ ] Your main package prints them.
- [ ] You build with `git rev-parse --short HEAD` for `GitCommit`.

---

## Task 4: `-trimpath` effect

Build a binary that panics. Compare stack traces with and without `-trimpath`.

**Acceptance criteria**
- [ ] Without: paths like `/Users/you/project/main.go`.
- [ ] With: paths like `example.com/myproj/main.go`.
- [ ] You note one benefit and one drawback.

---

## Task 5: Debug build

Build with `-gcflags='all=-N -l'` and run under `delve exec`.

**Acceptance criteria**
- [ ] `delve` can step into your code at the source level.
- [ ] You set a breakpoint in `main` and inspect a variable.
- [ ] You also try without `-N -l` and see the difference (optimized variables may not be visible).

---

## Task 6: See escape decisions

Build with `-gcflags='-m'` and identify three escaped values in your program.

**Acceptance criteria**
- [ ] You list each escape and the reason given by the compiler.
- [ ] You modify one to avoid escape and confirm with `-m`.

---

## Task 7: Cross-compile

Build for `linux/amd64`, `linux/arm64`, `darwin/arm64`, `windows/amd64`.

**Acceptance criteria**
- [ ] All four produce binaries.
- [ ] You confirm the platform with `file ./binary` (on Linux) or by other means.
- [ ] You list the binary sizes.

---

## Task 8: Race-detector test

Write code with an obvious data race. Run `go test -race ./...` and observe.

**Acceptance criteria**
- [ ] Test passes without `-race`.
- [ ] Test fails with `-race`, showing the race details.
- [ ] You fix the race with a `sync.Mutex` and re-run.

---

## Task 9: PGO workflow

Capture a CPU profile from a small benchmark and rebuild with PGO.

**Acceptance criteria**
- [ ] `go test -cpuprofile=cpu.pgo -bench=. ./pkg` produces a profile.
- [ ] Place `cpu.pgo` as `cmd/app/default.pgo`.
- [ ] `go build -pgo=auto ./cmd/app` succeeds.
- [ ] Bench shows some difference (may be small for trivial programs).

---

## Task 10: Build info inspection

Run `go version -m` on your binary.

**Acceptance criteria**
- [ ] You see the Go version, module info, tags, and flags.
- [ ] You verify `-X` injections show up in the embedded metadata.
- [ ] You compare two binaries built with different `-tags` sets.

---

## Task 11: Reproducible build

Build the same source twice with:

```bash
go build -trimpath -buildvcs=false \
  -ldflags="-buildid='' -s -w" \
  -o app .
```

**Acceptance criteria**
- [ ] `sha256sum app` produces the same hash both times.
- [ ] You change a single line, rebuild, and confirm the hash changes.

---

## Task 12: Static binary

Build a fully static binary.

**Acceptance criteria**
- [ ] `CGO_ENABLED=0 go build -ldflags='-s -w' .` on Linux.
- [ ] `file ./binary` reports "statically linked" or "no dynamic dependencies".
- [ ] Binary works in a `scratch` Docker container.

---

## Task 13: `-x -work` inspection

Build with `-x -work` and explore the work directory.

**Acceptance criteria**
- [ ] You list the directories and files in `$WORK`.
- [ ] You identify one compile command and one link command.
- [ ] You explain in one paragraph what `go build` actually does.

---

## Stretch — Task 14: Makefile bundle

Write a Makefile with `build`, `release`, `debug`, `cross`, `clean` targets.

**Acceptance criteria**
- [ ] `make build` is fast and produces a normal binary.
- [ ] `make release` produces stripped, version-injected, reproducible binary.
- [ ] `make debug` produces a delve-friendly binary.
- [ ] `make cross` produces binaries for at least 3 (`GOOS`, `GOARCH`) pairs.
- [ ] You commit the Makefile to the repo.

---

## Submission

Code + brief notes per task. The end state: a clean build pipeline you can replicate across projects.
