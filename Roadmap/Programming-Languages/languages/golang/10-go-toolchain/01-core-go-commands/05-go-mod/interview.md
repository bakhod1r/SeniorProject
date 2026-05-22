# go mod — Interview Q&A

Labeled by level. Concise answers.

---

## Junior

**Q1. What is a Go module and what is `go.mod`?**
A module is a versioned collection of packages with a `go.mod` at its root. `go.mod` declares the module path, the Go version, and the dependency requirements.

**Q2. How do you start a new module?**
`go mod init <module-path>`, e.g., `go mod init example.com/myapp`, which creates `go.mod`.

**Q3. What does `go mod tidy` do?**
It syncs `go.mod`/`go.sum` to the imports your code actually uses — adding missing requirements and removing unused ones, and updating `go.sum`.

**Q4. What is `go.sum` and should you commit it?**
It stores cryptographic checksums of dependency content for integrity. Yes — commit both `go.mod` and `go.sum`.

---

## Middle

**Q5. What does `// indirect` mean in go.mod?**
The module is required but not imported directly by your code — it is a transitive dependency (or recorded for version selection). `go mod tidy` maintains these markers.

**Q6. Difference between `go get` and `go mod tidy`?**
`go get` adds or upgrades a specific dependency/version. `go mod tidy` cleans the whole graph to match imports. Typically `go get pkg@version` then `go mod tidy`.

**Q7. What does `go mod why` tell you?**
The import chain explaining why a given module/package is in the build — invaluable for tracking down an unexpected dependency.

**Q8. When would you use `go mod vendor`?**
To copy dependencies into `vendor/` for hermetic, offline, auditable builds (common in air-gapped or high-security setups). Keep it in sync with `go mod vendor` after dependency changes.

---

## Senior

**Q9. How does Go select dependency versions?**
Minimal Version Selection (MVS): it picks the highest version required by any module in the graph — the minimum satisfying all requirements. Deterministic, no range solver.

**Q10. Why does Go not need a separate lockfile with version ranges?**
Because `go.mod` requirements are exact lower bounds and MVS deterministically computes the build list; `go.sum` adds integrity, not selection. The graph plus MVS fully determine versions.

**Q11. What changed with the `go 1.17` directive regarding the module graph?**
Graph pruning: `go.mod` records enough transitive requirements (more `// indirect` entries) to build your packages without loading the full graph. Bumping across that boundary changes tidy's output.

**Q12. What does `-mod=readonly` (the default) protect against?**
It prevents `go build`/`go test` from silently mutating `go.mod`/`go.sum`; if changes are needed the build fails, forcing a deliberate `go get`/`go mod tidy`.

---

## Professional

**Q13. What CI gate keeps go.mod/go.sum honest?**
A "tidy is a no-op" check: run `go mod tidy` then `git diff --exit-code go.mod go.sum`, failing if anything changed. Plus `go mod verify` for integrity.

**Q14. How do you handle private dependencies safely?**
Set `GOPRIVATE` (excludes them from the public sum DB/proxy) and use a private `GOPROXY` with `direct` fallback so internal code is not leaked and downloads are auditable.

---

## Common traps

- Thinking Go picks the *latest* version (it picks the minimum via MVS).
- Editing or deleting `go.sum` by hand to "fix" errors (run `go mod tidy`).
- Merging a local `replace` directive used for development.
- Expecting a library's `replace` to affect its consumers (only the main module's replaces apply).
- Forgetting `go mod tidy` and shipping a stale graph.
- `-mod=mod` in CI silently mutating dependencies.
