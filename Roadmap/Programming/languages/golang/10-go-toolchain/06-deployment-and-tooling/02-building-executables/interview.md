# Building Executables — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is the difference between a "debug" and a "release" Go binary?**
There is no `--release` flag. A release build is just `go build` with deliberate flags: `-trimpath` to scrub file paths, `-ldflags="-s -w"` to strip symbols and DWARF for size, and `-ldflags="-X main.version=..."` to stamp a version. The bytes are the result, not a separate mode.

**Q2. Why put the entry point under `cmd/<name>/main.go`?**
It scales: one repo can produce multiple binaries (`cmd/api`, `cmd/worker`, `cmd/migrate`) without colliding, and `go build ./cmd/api` is unambiguous. It is also the convention reviewers and tooling expect.

**Q3. How do you inject a version string at build time?**
Declare a package-level `var version = "dev"` in `main`, then build with `-ldflags="-X main.version=v1.2.3"`. The variable must be a `var` (not `const`), must be a `string`, and is referenced by its full import path.

**Q4. What does `-o` do in `go build`?**
It sets the output file name. Without it, Go derives the name from the package directory, which may collide with sources or differ across targets. Always pass `-o` for release builds.

---

## Middle

**Q5. Why use `-trimpath`?**
Without it, the binary embeds absolute file system paths (`/home/alice/projects/...`) into stack traces and metadata, leaking developer environment info and breaking reproducibility across machines. `-trimpath` replaces them with module-relative paths.

**Q6. What does `-ldflags="-s -w"` actually remove?**
`-s` strips the symbol table; `-w` strips DWARF debug info. Together they roughly halve binary size. They do **not** remove `.gopclntab`, so Go panic traces still print function names and line numbers, and `pprof` still works at the function level.

**Q7. How do you produce a statically linked Linux binary?**
`CGO_ENABLED=0 go build ...`. This uses Go's pure-Go `net` resolver and `os/user` implementations and the internal linker. With cgo enabled, you need `-extldflags='-static'` plus a static libc (musl), which is far more brittle.

**Q8. What is `runtime/debug.BuildInfo` and where does it come from?**
A struct returned by `debug.ReadBuildInfo()` containing the main module path/version, dependency list, and a `Settings` slice with build flags and VCS info (`vcs.revision`, `vcs.time`, `vcs.modified`). The linker embeds it; it is populated only when building via `go build`, not via custom toolchains or `go run` from a non-module context.

**Q9. Why does `go run` not produce a `BuildInfo` with a version?**
`go run` builds from a temporary location with `main.Version == "(devel)"` and no VCS metadata for a temporary build. For real version reporting, you must `go build` the binary.

---

## Senior

**Q10. What does a Go release pipeline contain beyond `go build`?**
Tagging (SemVer), matrix cross-compile, packaging (tar.gz/zip/deb/rpm/OCI), signing (cosign for blobs and images, codesign+notarytool for macOS, signtool for Windows), SLSA provenance attestation, SBOM generation (syft), publishing to GitHub Releases and container registries, and downstream updates (Homebrew tap, install script). `goreleaser` automates most of it from one YAML.

**Q11. Why ship from `distroless/static` instead of `alpine`?**
No shell or package manager (smaller attack surface), `nonroot` user out of the box, no glibc-vs-musl mismatch issues with `CGO_ENABLED=0` binaries, and ~3 MB smaller. Alpine made sense when distroless did not exist; for new Go services there is no reason to use alpine.

**Q12. What makes a build reproducible?**
Same source, same toolchain version (pin `go 1.23.4` in `go.mod` or set `GOTOOLCHAIN`), same flags including `-trimpath -ldflags="-s -w -buildid="`, same module graph (`-mod=readonly` with identical `go.sum`), no time-dependent embedded values. Independent rebuilds then produce byte-identical binaries, enabling supply-chain verification.

**Q13. What is `-buildmode=pie` and when do you use it?**
Position-Independent Executable: the binary can be loaded at any address, enabling ASLR for the executable itself. Cost: ~1–2% runtime, slightly bigger binary. Use it for production server binaries and any artifact shipped to users on hardened OSes; some distros require it.

---

## Professional

**Q14. Why does `pprof` symbolize stripped Go binaries at the function level but not the source-line level?**
`-s -w` removes the symbol table and DWARF, but `.gopclntab` (Go's PC→function/line table) is never stripped. `pprof` reads `.gopclntab` for function names and basic line info, so flame graphs work. Full source-line accuracy and type info come from DWARF, which is gone — that is the missing piece. The fix is to keep an unstripped binary indexed by build ID and symbolize profiles offline against it.

**Q15. A stripped binary panics in production. Will you get a useful stack trace?**
Yes. The Go runtime walks the stack using `.gopclntab`, which `-s -w` leaves intact, so panics print function names and source line numbers. You lose `gdb`/`delve` source-level stepping and detailed `pprof` line info, not stack traces.

**Q16. How does the build ID work and why do you care?**
The build ID is a hash of build inputs (action ID) plus output bytes (content ID), embedded in the binary and used as the build cache key. `go tool buildid ./api` reads it; `go version -m ./api` shows full embedded info. In incident response, it lets you match a deployed binary to its source commit and an offline unstripped symbol archive.

---

## Common traps

- Believing there is a "release mode" — there is not, only deliberate flags.
- Using `const` for the version variable (`-X` cannot set constants).
- Forgetting `-trimpath`, leaking developer paths into the binary and breaking reproducibility.
- Leaving `CGO_ENABLED=1` by default and shipping a dynamically linked binary that fails on `scratch`/`distroless`/Alpine.
- Stripping (`-s -w`) but having no offline symbol archive — production profiles become hard to read.
- Using `@latest` for the toolchain or tool versions in CI — builds are not reproducible.
- Naming all targets `bin/api` and silently overwriting each other in a cross-compile loop.
- Shipping the `golang:1.23` image to production (full toolchain, huge surface) instead of a multi-stage `distroless/static` final image.
- Forgetting macOS notarization — Gatekeeper blocks the binary at first launch on customer machines.
- Embedding build timestamps that vary per run, breaking reproducible builds and verification.
