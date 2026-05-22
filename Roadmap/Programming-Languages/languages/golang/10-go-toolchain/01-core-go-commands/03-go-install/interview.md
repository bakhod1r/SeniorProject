# go install — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What does `go install` do?**
It compiles a `main` package and copies the executable into your bin directory (`GOBIN` or `$GOPATH/bin`) so you can run it by name from anywhere.

**Q2. How is it different from `go build`?**
`go build` writes the binary to the current directory (or `-o` path). `go install` writes it to the bin directory and names it after the package, making it runnable as a command.

**Q3. You installed a tool but the shell says "command not found." Why?**
Your bin directory is not on `PATH`. Add `$(go env GOPATH)/bin` (or `$(go env GOBIN)`) to `PATH`.

**Q4. How do you install a third-party CLI tool?**
`go install path@version`, e.g., `go install honnef.co/go/tools/cmd/staticcheck@v0.5.1`. The `@version` suffix is required for remote installs.

---

## Middle

**Q5. Where does the installed binary go, and what is it named?**
To `GOBIN` if set, otherwise `$GOPATH/bin`. The name is the last element of the package path (`.../cmd/server` → `server`). There is no `-o`.

**Q6. What does `@latest` resolve to, and when should you avoid it?**
The highest released version (excluding pre-releases unless none exist). Avoid it in CI/scripts because it is non-reproducible; pin `@vX.Y.Z` there.

**Q7. Does `go install tool@version` use your project's go.mod?**
No. With a version suffix it runs in isolated module mode, building the tool with its own dependencies and ignoring your `go.mod`.

**Q8. How do you check which version of a tool is installed?**
`go version -m "$(go env GOPATH)/bin/<tool>"` prints the module path, version, and build settings baked into the binary.

---

## Senior

**Q9. Where do cross-compiled installs go?**
If `GOOS`/`GOARCH` differ from the host, into `$GOPATH/bin/<goos>_<goarch>/` to avoid clobbering the native binary — unless `GOBIN` is set, which overrides that.

**Q10. Why might `go install tool@latest` perform a network call even when nothing changed?**
`@latest` re-resolves the version on every invocation (a proxy/VCS query). The build may still be cached if the resolved version is unchanged, but the version query always happens.

**Q11. How is `go install` a supply-chain concern?**
It downloads and runs third-party build logic with your privileges. Mitigate with pinned versions, a controlled `GOPROXY`, `GOSUMDB`/`go.sum` verification, and auditing installed binaries with `go version -m`.

**Q12. Why might a global `GOFLAGS=-mod=vendor` break `go install tool@version`?**
The `@version` install needs module mode to resolve the tool's own graph, which conflicts with vendor mode. You may need `-mod=mod` or to unset `GOFLAGS` for the install.

---

## Professional

**Q13. How does a team eliminate tool version drift?**
Manage versions centrally: `go.mod` `tool` directives (Go 1.24+), a `tools.go` file, or pinned versions in a Makefile. Ban ad-hoc `@latest` in committed files and enforce it in review.

**Q14. What's the modern way to track tools in a module?**
The Go 1.24 `tool` directive: `go get -tool path` adds a `tool` line to `go.mod`; then `go install tool` installs all pinned tools and `go tool name` runs one. Versions are reviewed alongside code.

---

## Common traps

- "command not found" → bin directory not on PATH.
- Forgetting `@version` on remote installs.
- Expecting `go install` to honor your `go.mod` for `@version` tools (it does not).
- Expecting an `-o` flag (there is none).
- Using `@latest` in CI and getting non-reproducible builds.
- Looking for a cross-compiled binary in `bin/` instead of `bin/<os>_<arch>/`.
- Trying to install a library package (only `main` is installable).
