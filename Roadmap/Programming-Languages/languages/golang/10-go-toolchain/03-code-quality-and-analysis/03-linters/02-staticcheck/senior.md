# staticcheck — Senior

## 1. Architecture: `go/analysis` underpinnings

Staticcheck is built on top of `golang.org/x/tools/go/analysis`, the same framework that powers `go vet`. Each check is an `*analysis.Analyzer` with a `Run` function, declared dependencies on other analyzers (e.g., one that builds SSA, one that produces facts), and a set of `Facts` it may emit. The driver loads packages with `go/packages`, type-checks them, and then runs analyzers in dependency order, caching per-package results.

This matters in practice for three reasons:

- Staticcheck analyzers can be embedded in any other `go/analysis` driver — `golangci-lint`, `gopls`, `unitchecker`, custom drivers.
- Adding `go/analysis` analyzers to staticcheck (custom team checks) is straightforward.
- Performance characteristics — caching, parallelism, fact propagation — are the framework's, not staticcheck's bespoke logic.

---

## 2. Standalone vs `golangci-lint` vs `gopls`

The same staticcheck analyzers are exposed via several entry points:

| Driver | When to use |
|--------|-------------|
| `staticcheck` CLI | Definitive, full-fidelity behavior; CI gate; `-explain` available |
| `golangci-lint` | You already aggregate many linters; want shared cache and one config |
| `gopls` (in your IDE) | Real-time feedback while editing; subset of checks |
| `unitchecker` | Embed staticcheck inside `go vet -vettool=...` for a single-binary pipeline |

Subtle difference: `golangci-lint` historically lagged behind staticcheck releases by weeks. If your team needs the newest checks immediately, run staticcheck standalone alongside `golangci-lint`. Versions should be pinned in both either way.

---

## 3. Version pinning is non-negotiable

```bash
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
```

Staticcheck releases periodically change check semantics: new checks land, false-positive patches change which lines fire, and target Go version handling evolves. With `@latest`, two engineers can see different findings on the same code. Pin the version in:

- `Makefile` / `justfile` targets (`STATICCHECK_VER := v0.5.1`).
- CI workflows (`go install honnef.co/go/tools/cmd/staticcheck@${STATICCHECK_VER}`).
- A `tools.go` or `go.mod` `tool` directive (Go 1.24+) if you prefer to vendor tool versions.

When upgrading staticcheck, treat it as a dependency upgrade: open a PR, review the diff in findings, fix or ignore as appropriate, merge.

---

## 4. Rolling out on a legacy codebase

A direct `staticcheck ./...` on a 200k-line legacy repo will surface thousands of findings and demoralize the team. Stage the rollout:

1. **Baseline mode** — run staticcheck, save findings to a baseline file, fail CI only on **new** findings. There is no first-class baseline mode in staticcheck itself; common approach is a diff against `main`'s output, or use `reviewdog` which natively supports diff-based reporting.
2. **`SA` only first** — `staticcheck -checks=SA* ./...`. Fix or `//lint:ignore` everything. These are bugs.
3. **Add `U1000`** — delete dead code in a separate PR per package.
4. **Add `S*`** — accept simplifications; many are trivial.
5. **Add `ST*` last** — debate `staticcheck.conf` style choices in a single design meeting, then commit.

Pin the version before each stage; do not let an upgrade collide with a rollout step.

---

## 5. Per-subtree configuration

Use nested `staticcheck.conf` files to apply different policies to different parts of the repo:

```
/staticcheck.conf                 # strict policy
/internal/legacy/staticcheck.conf # relaxed: only SA*, no U checks
/cmd/.../                         # inherits root
```

```toml
# internal/legacy/staticcheck.conf
checks = ["SA*"]
```

This lets you freeze the legacy subtree while applying full rigor to new code. It is the most under-used staticcheck feature in real teams.

---

## 6. Team policy questions to settle

Decide and document, ideally in `CONTRIBUTING.md`:

| Question | Typical answer |
|----------|----------------|
| Which checks are blocking? | All `SA`, all `U`, most `S`; selected `ST` |
| Are `//lint:ignore` reasons mandatory in review? | Yes — bare ignores are blocked |
| Is `-set_exit_status` set in CI? | Yes |
| Which Go version does `-go` target? | Match `go.mod`'s `go` directive |
| Pinned staticcheck version lives where? | One place (Makefile or `tools.go`) |
| Generated files exempt? | Yes — exclude via `//lint:file-ignore` or path filter |

Bake the rules into config and pre-commit hooks, not human reviewer memory.

---

## 7. False positives: triage and report

A real false positive is rare but possible. The triage:

1. Read `staticcheck -explain SAXXXX` carefully — most "false positives" are actually correct.
2. Reduce the case to a minimal example.
3. Search the issue tracker for similar reports: https://github.com/dominikh/go-tools/issues.
4. If genuinely a bug, open an issue with the minimal example and the staticcheck version.
5. Suppress locally with `//lint:ignore SAXXXX upstream issue #NNNN, see <link>`.

Reviewing PRs, treat `//lint:ignore` directives like `// nolint`: a code smell that requires justification. The reason after the ID should explain *why*, not *what*.

---

## 8. Performance characteristics

On a warm cache, staticcheck on a medium repo (~100k LOC) takes seconds. Cold, it can take minutes because every package must be type-checked. Optimization levers:

- Persist `GOCACHE` across CI runs (same as for `go build`).
- Persist staticcheck's own cache, located under `$XDG_CACHE_HOME/staticcheck` (or `$HOME/.cache/staticcheck`).
- Avoid invalidation: pinning the staticcheck binary version is critical because the cache is keyed partly on tool version.
- Use `-debug.max-concurrent-jobs=N` to cap parallelism in constrained CI containers (default uses GOMAXPROCS).

---

## 9. Embedding in custom drivers

For a single-binary pipeline (one tool that runs vet + staticcheck + your in-house analyzers), build a `unitchecker`:

```go
package main

import (
    "golang.org/x/tools/go/analysis/unitchecker"
    "honnef.co/go/tools/analysis/lint"
    "honnef.co/go/tools/staticcheck"
)

func main() {
    var analyzers []*analysis.Analyzer
    for _, a := range staticcheck.Analyzers {
        analyzers = append(analyzers, a.Analyzer)
    }
    unitchecker.Main(analyzers...)
}
```

Then invoke via `go vet -vettool=$(which mytool) ./...`. This composes naturally with the rest of the Go toolchain and is how `golangci-lint` and similar tools integrate analyzers.

---

## 10. Summary

Staticcheck is a `go/analysis`-based driver with the same engine as `go vet` but a much larger check catalog. Pin the version (`@v0.5.x`), choose one entry point (standalone, `golangci-lint`, or `unitchecker`), roll out on legacy code by family (`SA` → `U` → `S` → `ST`), and use nested `staticcheck.conf` for subtree policies. Settle team rules in writing — which checks block, mandatory ignore reasons, `-go` target — and treat staticcheck upgrades as dependency upgrades with their own PRs.

---

## Further reading
- `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis
- Staticcheck releases: https://github.com/dominikh/go-tools/releases
- Integrating staticcheck: https://staticcheck.dev/docs/running-staticcheck/cli/
