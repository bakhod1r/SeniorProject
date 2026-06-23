# Build Tags — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is a build tag?**
A special comment (`//go:build linux`) above the `package` clause that tells the Go tool whether to compile the file. If the constraint is false, the file is silently skipped.

**Q2. What are the two syntactic forms?**
The modern `//go:build linux` (Go 1.17+) and the legacy `// +build linux` (pre-Go 1.17). `gofmt` keeps both in sync during migration; new code should use only the modern form.

**Q3. Where must the constraint appear in the file?**
Above the `package` clause, with a **blank line** between the constraint and `package`. Without the blank line, Go treats it as a doc comment and the constraint does nothing.

**Q4. What does the file name `foo_linux.go` mean?**
It is an implicit build constraint: this file is compiled only when `GOOS=linux`. Same as writing `//go:build linux` at the top of the file.

---

## Middle

**Q5. How do `&&`, `||`, and `!` work in `//go:build`?**
Standard Boolean operators with usual precedence (`!` > `&&` > `||`). Example: `//go:build (linux || darwin) && !arm64`. The legacy form is different: space = OR, comma = AND, separate lines = AND.

**Q6. How do you enable a custom tag?**
Pass `-tags`: `go build -tags=integration .` or `go test -tags="integration e2e" ./...`. You can also set `GOFLAGS=-tags=integration` so every `go` command inherits it.

**Q7. What is the `unix` tag and why use it?**
A predefined umbrella tag (Go 1.19+) that is true for all Unix-like systems (`linux`, `darwin`, `freebsd`, `openbsd`, ...). Use it instead of listing each OS: `//go:build unix` is cleaner than `//go:build linux || darwin || freebsd || ...`.

**Q8. What predefined tags can I rely on?**
One per `GOOS`, one per `GOARCH`, `cgo`, `gc`/`gccgo`, `unix`, `boringcrypto`, and one `go1.X` per released minor version up to and including the running toolchain.

---

## Senior

**Q9. Build tag vs runtime `runtime.GOOS` check — when do you use which?**
Build tag when code uses OS-specific imports (e.g., `syscall`), when binary size of unused branches matters, or when selection should be frozen at build time (CE vs Enterprise). Runtime check when all variants compile on every OS and you want flexibility without rebuilding.

**Q10. Why pair `//go:build cgo` with `//go:build !cgo`?**
Without the `!cgo` fallback, your package fails to build whenever someone disables cgo (`CGO_ENABLED=0`) — common in cross-compilation. Both files must export the same signatures so the caller is oblivious to which one was linked.

**Q11. How does each tag combination affect the build cache?**
Each unique combination of `-tags`, `GOOS`, `GOARCH`, `CGO_ENABLED`, and toolchain version is a separate `GOCACHE` key. Building the same package three ways populates three independent cache entries — proliferating tags means proliferating cache entries and slower CI.

**Q12. How do you ship two binaries (Community and Enterprise) from one repo?**
Default build is CE (no tags). Add a `//go:build enterprise` file for paid features. CI runs both: `go build -o bin/ce .` and `go build -tags=enterprise -o bin/ee .`. Default should always be the conservative build — opt **in** to extras.

---

## Professional

**Q13. What happens when `//go:build` and `// +build` disagree?**
Modern Go versions error out. The two forms must agree because `gofmt` is supposed to keep them in lockstep — disagreement signals a hand-edit gone wrong. The modern `//go:build` is preferred and authoritative.

**Q14. How do `go vet` and `gopls` know about your custom tags?**
Both accept `-tags` (or `build.buildFlags` in `gopls` config). Without it, vet only checks the default build and `gopls` shows red squiggles in tag-gated files because it can't resolve their imports. CI should vet every combination it builds.

**Q15. How do you confirm a tag actually included your file?**
`go list -tags=integration -f '{{.GoFiles}}' .` lists the included files; `go list -f '{{.IgnoredGoFiles}}' .` shows what was filtered out. For the binary, `go version -m ./app` reveals which `-tags` were active at build time.

---

## Common traps

- Missing the blank line after `//go:build` — the constraint silently becomes a doc comment.
- Putting the constraint **below** the `package` clause — ignored entirely.
- File-name typo (`_linus.go`, `_LINUX.go`) — not recognized as a constraint, file compiles on all platforms.
- Writing `//go:build linux` and `// +build windows` in the same file — they disagree; modern Go errors out.
- Forgetting `//go:build !cgo` fallback when using cgo — cross-compilation breaks.
- Stacking too many custom tags — combinatorial cache explosion in CI.
- Confusing legacy syntax: `// +build !windows linux` means "(NOT windows) OR linux", not "NOT (windows OR linux)".
- Setting `-tags` only at build time but forgetting `go vet -tags=...` and `gopls` `buildFlags` — silently broken tag-gated code.
- Running tests with `go test ./...` and assuming `//go:build integration` files are exercised — they are not; you must pass `-tags=integration`.
