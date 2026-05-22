# go version — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What does `go version` print?**
The Go toolchain version and platform, e.g., `go version go1.23.0 linux/amd64` — the version (`go1.23.0`) and the OS/CPU (`linux/amd64`).

**Q2. How do you find which Go version built a binary?**
`go version <binary>`, e.g., `go version ./app`, prints the Go version embedded in the executable.

**Q3. Is `go version` the version of my application?**
No — it is Go's own toolchain version, not your app's. Your app's version is whatever you stamp in (e.g., via `-ldflags -X`).

**Q4. What does `go version -m <binary>` add?**
The embedded module/build manifest: the dependency versions, build flags, and VCS info baked into the binary.

---

## Middle

**Q5. What is the difference between `go version` and the `go 1.XX` directive in go.mod?**
`go version` is the toolchain you are running; the `go` directive is the *minimum* Go version your module requires (controls language features and module behavior).

**Q6. What useful fields does `go version -m` show?**
`mod`/`dep` (exact module versions), `build` settings (`-trimpath`, `CGO_ENABLED`), and `vcs.*` (commit, time, dirty flag) — i.e., what actually shipped.

**Q7. What is GOTOOLCHAIN?**
A setting (default `auto`) that controls which toolchain version is used. `auto` downloads a newer one if `go.mod` requires it; `local` always uses the installed one; `goX.Y.Z` forces a specific version.

**Q8. What does the `toolchain` directive do?**
Pins the toolchain version to build with (e.g., `toolchain go1.23.1`), so with `GOTOOLCHAIN=auto` everyone builds with the same version.

---

## Senior

**Q9. Why might `go version` report a version you never installed?**
Since Go 1.21, with `GOTOOLCHAIN=auto`, the `go` command auto-downloads and re-execs a newer toolchain when the module requires it. The active version is computed, not fixed.

**Q10. How is `go version -m` a security tool?**
It exposes the exact dependency versions and provenance embedded in a binary, so you can triage vulnerabilities (cross-check with `govulncheck -mode=binary`) and verify provenance (`vcs.revision`, `vcs.modified`) on artifacts you did not build.

**Q11. Why does the toolchain version matter for reproducible builds?**
Byte-identical builds require the same toolchain version (it affects codegen and even gofmt output). Pin the `toolchain` directive and `GOTOOLCHAIN` so dev and CI match.

**Q12. What does `vcs.modified=true` in `go version -m` indicate?**
The source tree was dirty (uncommitted changes) at build time — a provenance red flag for a release artifact.

---

## Professional

**Q13. How do you keep toolchain versions consistent across a team?**
Pin via the `go.mod` `toolchain` directive, set a deliberate `GOTOOLCHAIN` policy, align the CI image, and assert the active version in CI (`go version | awk ...`) so drift fails fast.

**Q14. What's the policy difference between `GOTOOLCHAIN=auto` and `local`?**
`auto` downloads toolchains as needed (convenient, checksum-verified) but unsuitable for air-gapped CI; `local` uses the provisioned toolchain and errors if too old (full control). Air-gapped setups use `local` plus a mirrored proxy.

---

## Common traps

- Confusing the toolchain version with the app's version.
- Confusing `go version` (installed/active) with the `go` directive (minimum required).
- Being surprised the reported version differs from what you installed (auto-selection).
- Thinking `go version <bin>` reports the target platform (it reports the Go version; use `file` for OS/arch).
- Using `auto` in air-gapped CI and having downloads fail.
- Shipping `vcs.modified=true` artifacts.
