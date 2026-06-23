# go run — Hands-on Tasks

Work through these in order. Each has explicit acceptance criteria. Use Go 1.21+.

---

## Task 1: First run

Create `hello.go` with a `main` that prints `"hello"` and run it.

**Acceptance criteria**
- [ ] `go run hello.go` prints `hello`.
- [ ] After running, `ls` shows no `hello` executable in the directory.

---

## Task 2: Multi-file package

Split your program: put `func greet(name string) string` in `greet.go` and call it from `main.go`. Both `package main`.

**Acceptance criteria**
- [ ] `go run main.go` fails with an "undefined: greet" error.
- [ ] `go run .` succeeds and prints the greeting.
- [ ] You can explain in one sentence why the first failed.

---

## Task 3: Arguments vs build flags

Write a program that prints `os.Args[1:]`. Then enable the race detector.

**Acceptance criteria**
- [ ] `go run . a b c` prints `[a b c]`.
- [ ] `go run -race .` runs with the race detector enabled (verify with a deliberate data race that triggers a `DATA RACE` report).
- [ ] You can show that `go run . -race` passes `-race` to the program (it appears in the printed args), not to the build.

---

## Task 4: Inject a version string

Add `var version = "dev"` and print it. Override it at run time.

**Acceptance criteria**
- [ ] `go run .` prints `version: dev`.
- [ ] `go run -ldflags="-X main.version=1.2.3" .` prints `version: 1.2.3`.

---

## Task 5: See and keep what `go run` does

Use the debug flags.

**Acceptance criteria**
- [ ] `go run -x .` prints the compile, link, and run commands.
- [ ] `go run -work .` prints a `WORK=...` path and that directory still exists afterward.
- [ ] You locate the linked executable inside that work directory.

---

## Task 6: Run a tool without installing it

Use a versioned remote tool.

**Acceptance criteria**
- [ ] `go run golang.org/x/tools/cmd/stringer@latest -help` runs and prints usage (network required).
- [ ] Your project's `go.mod` is **unchanged** afterward (`git diff go.mod` is empty).

---

## Task 7: Exit codes

Make `main` call `os.Exit(3)` under some condition.

**Acceptance criteria**
- [ ] `go run . ; echo $?` prints `3`.
- [ ] Introduce a compile error, then confirm `go run .` exits non-zero *before* any of your output appears (build failure vs runtime failure).

---

## Task 8: Why not as an entrypoint (reflection)

Write a tiny HTTP server and run it two ways: `go run .` and `go build -o app && ./app`.

**Acceptance criteria**
- [ ] You measure (roughly, with `time`) that repeated `go run .` re-links each time while `./app` starts instantly.
- [ ] You write 2–3 sentences explaining why `go run` is unsuitable as a container entrypoint (startup cost, ships compiler/source, image size).
