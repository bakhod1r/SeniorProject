# go build — Interview Q&A

Labeled by level. Keep answers concise; expand with examples in person.

---

## Junior

**Q1. What does `go build` produce?**
For a `main` package, an executable on disk (named after the directory/module by default, or via `-o`). For a library package, nothing is written — it just type-checks the code.

**Q2. How is `go build` different from `go run`?**
`go build` writes a persistent binary you run separately and reuse. `go run` builds to a temp location, runs once, and deletes it.

**Q3. How do you name the output file?**
With `-o`: `go build -o app .`. The flag goes before the package path.

**Q4. How do you build every package in a module?**
`go build ./...` compiles and type-checks all packages recursively.

---

## Middle

**Q5. How do you cross-compile for Linux from a Mac?**
Set the target env: `GOOS=linux GOARCH=amd64 go build -o app .`. Pure-Go programs need no extra toolchain.

**Q6. How do you embed a version string at build time?**
`go build -ldflags="-X main.version=$(git describe --tags)" .`, with a package-level `var version string`.

**Q7. What does `-trimpath` do and why use it?**
It removes absolute source paths from the binary, making builds reproducible and avoiding leaking developer home-directory paths.

**Q8. Why build with `CGO_ENABLED=0` for containers?**
It produces a fully static binary with no libc dependency, so it runs in `scratch`/`distroless/static` images.

---

## Senior

**Q9. What inputs form the build cache key?**
Source contents, the import graph, build/link flags, build tags, the toolchain version, and environment like `GOOS`/`GOARCH`/`CGO_ENABLED`. Any change creates a new cache entry.

**Q10. If you change `-ldflags -X version`, does Go rebuild every package?**
No. Package compilation is cached; only the link step changes (the version stamp is a link input). That is fast and expected.

**Q11. What is `-buildvcs` and when does it bite you?**
Go embeds VCS metadata (commit, dirty flag) into binaries when building from a repo. In Docker/CI without `.git`, the build can fail; use `-buildvcs=false`.

**Q12. How do you make a byte-for-byte reproducible binary?**
`CGO_ENABLED=0`, `-trimpath`, `-ldflags="-buildid="` (and stripping if desired), a pinned toolchain, and pinned dependencies (`go.sum`). Verify by diffing two independent builds.

---

## Professional

**Q13. How does a team guarantee identical builds across engineers and CI?**
Centralize flags in a Makefile/GoReleaser config (trimpath, pinned ldflags, CGO setting), pin the toolchain via `GOTOOLCHAIN` and the `go` directive, pin dependencies, and reject ad-hoc `go build` invocations in review.

**Q14. What flags differ between debug and release builds?**
Debug: `-gcflags="all=-N -l"` to keep symbols and disable inlining for delve. Release: `-ldflags="-s -w"` to strip symbols and shrink size. Never ship the debug build or debug the stripped one.

---

## Common traps

- Expecting a binary from a library package (only `main` produces one).
- Putting `-o` after the package path.
- `-o dir/` (directory, multiple binaries) vs `-o file` (single file) confusion.
- cgo cross-compilation failing without a C cross-compiler — fix with `CGO_ENABLED=0`.
- Thinking version stamping forces a full rebuild (only relinks).
- VCS stamping failing in Docker without `.git`.
- Using `-a` "to be safe" and destroying cache performance.
