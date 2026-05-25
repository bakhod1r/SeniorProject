# go vet — Interview Q&A

A mix of conceptual and practical questions, labeled by level. Answers are concise; expand with examples in a real interview.

---

## Junior

**Q1. What is `go vet`?**
It is Go's built-in static analyzer. It reads source without running it and reports a small set of high-confidence bugs — printf format mismatches, unreachable code, malformed struct tags, lost `cancel` functions, etc. Ships with the toolchain; no install or config needed.

**Q2. How do you run it on a whole module?**
`go vet ./...` — vets every package in the current module. Exit code is non-zero if any diagnostic is reported.

**Q3. Give an example of a bug vet catches that the compiler accepts.**
`fmt.Printf("%d", "hello")` compiles fine (printf takes `...any`) but vet reports `Printf format %d has arg "hello" of wrong type string`.

**Q4. Is `go vet` a linter?**
No. A linter catches style or likely improvements and tolerates some false positives. Vet is designed for **zero false positives** — it only reports real bugs. That is why it is safe to run automatically inside `go test`.

---

## Middle

**Q5. Name five built-in analyzers and what they catch.**
- `printf` — format verb vs argument type mismatches.
- `unreachable` — code after `return`/`panic`.
- `structtag` — malformed struct tags (e.g., missing quotes).
- `lostcancel` — `context.WithCancel` whose `cancel` is never called.
- `copylocks` — copying a value containing a `sync.Mutex`.

**Q6. How do you turn off a single analyzer?**
Each analyzer has a per-name flag: `go vet -printf=false ./...`. To skip vet entirely during a test: `go test -vet=off ./...`.

**Q7. How does `go test` interact with `go vet`?**
`go test` runs a defensive subset of vet before executing tests (printf, atomic, bool, ifaceassert, ...). If a diagnostic fires, the package is reported as `FAIL ... [vet]` and tests do not run. Override with `-vet=off`, `-vet=all`, or `-vet=printf,shadow`.

**Q8. What is `-vettool` for?**
It lets `go vet` run an external analyzer binary using the same plumbing (package loading, caching, reporting). Any binary built from `singlechecker`/`multichecker`/`unitchecker` works: `go vet -vettool=$(which fieldalignment) ./...`.

---

## Senior

**Q9. When would you reach for `staticcheck` or `golangci-lint` instead of vet?**
Vet covers only true bugs. For broader coverage — unused code, performance pitfalls, naming, style, dead branches — use staticcheck (bug-focused, low false positives) or golangci-lint (aggregator of many linters). The right policy is **all three**: vet as required baseline, staticcheck for deeper bug checks, golangci-lint for style/repo-specific rules.

**Q10. How do you write a custom analyzer?**
Implement `*analysis.Analyzer` from `golang.org/x/tools/go/analysis`: provide a `Name`, `Doc`, `Run`, and optional `Requires` (e.g., `inspect.Analyzer`). Inside `Run`, walk the AST/SSA and call `pass.Reportf(pos, ...)` for diagnostics. Wrap with `singlechecker.Main(Analyzer)` for a standalone binary, `multichecker.Main(...)` for several, or `unitchecker.Main(...)` to plug into `go vet -vettool=...`.

**Q11. What is a "Fact" in the analysis framework and why does it matter?**
A Fact is a piece of information an analyzer exports about a package symbol (object) or whole package, which other analyzers (or the same analyzer in a downstream package) can import. The driver gob-encodes facts into the build cache, so cross-package reasoning scales: each package is analyzed once and its facts propagate up the import graph. `printf` uses this to recognize user-defined printf-like functions.

**Q12. Why does the Go team refuse vet additions that produce occasional false positives?**
Because vet runs inside `go test`. A false positive there means tests fail spuriously and people learn to ignore the tool. The zero-false-positive contract is what justifies making vet non-optional. Heuristic checks belong in opt-in linters.

---

## Professional

**Q13. Under the hood, how does `go vet -vettool=mybin ./...` work?**
`go vet` discovers the package set, loads packages, and for each one invokes `mybin` over a defined `unitchecker` protocol with the package's facts and type info on stdin. `mybin` runs its registered analyzers and returns diagnostics + new facts, which the driver caches in `GOCACHE` keyed by source hash + analyzer identity + flags. The tool inherits parallelism, caching, and uniform reporting from `go vet`.

**Q14. What busts the vet cache?**
Source changes (your package or any dependency whose facts you import), analyzer flag changes, switching `-vettool` binary, toolchain version, and build environment (`GOOS`, `GOARCH`, build tags). Each combination has its own cache key, so vetting an unchanged tree is essentially a cache lookup.

**Q15. In a monorepo, how do you keep vet fast on PRs?**
Persist `GOCACHE` between CI jobs; vet only changed packages on PRs (`go vet $(git diff --name-only ... | xargs ...)`); run `go vet ./...` on `main` post-merge for full coverage. Consider a `unitchecker` binary that bundles vet + staticcheck + custom analyzers so package loading happens once per run.

---

## Common traps

- Treating vet diagnostics as advisory. They are bugs — fix them.
- Assuming `go test` runs the **full** vet set (it runs only a defensive subset; use `go test -vet=all` for full).
- Putting flags after the package (`go vet ./... -printf=false` does nothing for vet; flags go before).
- Using `-vettool=` to a binary that is not a `unitchecker` (you get protocol errors).
- Silencing vet via `//nolint` or by deleting it from CI — the contract was zero false positives, so a diagnostic almost always points to a real bug.
- Confusing vet with linters and asking it to enforce style (it deliberately won't).
- Forgetting `shadow` is **off by default** in stock vet; if you want it, enable explicitly or use a `vettool`.
- Assuming custom printf-like functions are checked automatically — they need to be discoverable as printf-like (registered via `// fmt.Printf-style` recognition or analyzer config).
