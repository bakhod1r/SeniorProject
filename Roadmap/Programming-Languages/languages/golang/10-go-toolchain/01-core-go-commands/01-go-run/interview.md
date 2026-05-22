# go run — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What does `go run` do?**
It compiles the named Go program into a temporary binary, runs it, and deletes the binary afterward. One command to compile-and-execute.

**Q2. How is `go run` different from `go build`?**
`go build` produces a persistent executable on disk that you run separately. `go run` builds to a temp location, runs it, and removes it — no artifact is left behind.

**Q3. Why use `go run .` instead of `go run main.go`?**
`go run .` includes every file in the current `main` package. `go run main.go` only compiles that one file, so functions defined in sibling files cause "undefined" errors.

**Q4. Where do command-line arguments after the file go?**
To your program. `go run main.go a b c` passes `a b c` as `os.Args[1:]`. Build flags must come *before* the package/file.

---

## Middle

**Q5. Is Go interpreted when you use `go run`?**
No. `go run` does a full compile and link every time; it just discards the binary. It is not an interpreter.

**Q6. Why is the second `go run` of unchanged code faster than the first?**
Compiled packages are stored in the build cache (`GOCACHE`). Subsequent runs reuse cached objects and only relink, so they are faster.

**Q7. You ran `go run main.go -race` to enable the race detector but it didn't fire. Why?**
`-race` came *after* the file, so it was passed to your program as an argument, not to the build. The correct form is `go run -race main.go`.

**Q8. How do you run a tool without adding it to your go.mod?**
`go run example.com/cmd/tool@v1.2.3` — the `@version` suffix runs it in module-aware mode without modifying your project's dependencies.

---

## Senior

**Q9. Should `go run` be a Docker container entrypoint? Why or why not?**
No. It ships the compiler and source, recompiles on every container start (slow startup), and bloats the image and attack surface. Build a static binary in a multi-stage Dockerfile and run that.

**Q10. What busts the `go run` build cache and forces recompilation?**
Source changes, changing build flags (`-tags`, `-race`, `-gcflags`, `-ldflags`), changing the toolchain version, or changing build environment (`GOOS`, `GOARCH`, `CGO_ENABLED`). Each distinct flag/env combination is a separate cache key.

**Q11. Can you cross-compile and run with `go run`?**
You can cross-*compile* (`GOOS=linux GOARCH=arm64 go run .`), but `go run` then tries to execute the foreign binary locally and fails — unless you supply an `-exec` runner (e.g., qemu, the wasm exec script). Cross-platform output belongs to `go build`.

**Q12. How do you inspect the exact binary `go run` produced?**
Use `go run -work .` to keep the temp work directory (it prints `WORK=...`), or better, `go build -o ./app` for a stable binary you can profile, debug, or run `go version -m` against.

---

## Professional

**Q13. How does a team pin tool versions used via `go run`?**
Pin `@vX.Y.Z` in `go:generate` directives and Makefile targets, or declare them via `go.mod tool` directives (Go 1.24+) / a `tools.go` build-tagged file. Never `@latest` in CI — it is non-reproducible.

**Q14. What is the security concern with `go run tool@latest`?**
It downloads and executes arbitrary third-party code with the user's privileges. Mitigate by pinning versions, using a controlled `GOPROXY`, enforcing `GOSUMDB`/`go.sum` verification, and `-mod=readonly`.

---

## Common traps

- Assuming `go run` is interpreted (it compiles every time).
- Putting build flags after the package (they go to the program).
- Using `go run main.go` in a multi-file package.
- Using `go run` as a production/container entrypoint.
- Expecting a leftover binary (there is none — use `go build -o`).
- Using `@latest` for tools in CI and wondering why builds are not reproducible.
- Forgetting the program's CWD is the caller's directory, not the source directory.
