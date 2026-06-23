# golangci-lint — Senior

## 1. Architecture: one analysis, many linters

Most modern Go linters are written against the `golang.org/x/tools/go/analysis` framework. An *analyzer* declares its dependencies (other analyzers' results) and a single `Run(*Pass) (any, error)` function. `golangci-lint` is a driver over this framework:

1. Load packages once via `go/packages` (parses + type-checks).
2. Build the analyzer DAG from every enabled linter.
3. Run analyzers in topological order, **reusing** the type information, SSA form, and intermediate results across linters.
4. Collect issues, deduplicate, filter via `issues.exclude-rules`, and print.

The win is that `govet`, `staticcheck`, `errcheck`, `unused`, and friends do not each re-parse and re-type-check your code — that work happens once for all of them.

---

## 2. The linter cache

`golangci-lint` keeps its own cache at `$GOLANGCI_LINT_CACHE` (default `~/.cache/golangci-lint`):

```
~/.cache/golangci-lint/
├── v1.59.1/
│   ├── analysis/       # per-(package, analyzer-set) results
│   └── packages/       # packages.Load output
```

Cache key inputs include: golangci-lint version, Go version, set of enabled linters, their settings, and the package content hashes. Change any of those and the entry is invalidated. In CI, you want to **persist this directory between runs** — a cold cache on a large repo can mean minutes of re-analysis.

---

## 3. Designing `.golangci.yml` for a large team

Principles:

1. **Least surprise.** `disable-all: true` plus explicit `enable:` — never inherit defaults from a future release.
2. **Gradual adoption.** Introduce strict linters with `severity: warning` first, flip to `error` later.
3. **Per-path rules.** Tests and generated code rarely deserve the same checks as production code.
4. **Document why each rule is on or off**, inline with comments.

```yaml
linters:
  disable-all: true
  enable:
    - govet
    - staticcheck
    - errcheck
    - ineffassign
    - unused
    - gocritic
    - revive
    - gosec
    # - dupl       # too noisy on table tests, revisit Q4
    # - gocognit   # planned: enable after refactor of /internal/billing

issues:
  exclude-rules:
    - path: _test\.go
      linters: [errcheck, gosec, dupl]
    - path: ^cmd/migrate/
      linters: [gocyclo, gocognit]  # generated migration code
    - text: "G404"            # math/rand for non-crypto IDs is fine
      linters: [gosec]

severity:
  default-severity: error
  rules:
    - severity: warning
      linters: [gocritic, revive]
```

Code review the lint config the same way you review code: every exclude has an owner and a comment.

---

## 4. Gradual adoption with `--new-from-rev`

For repos with a long history of un-linted code, the safe rollout pattern is:

1. Land the `.golangci.yml` with full linter set enabled.
2. In CI, run with `--new-from-rev=origin/main`. Existing findings are ignored; only PR-introduced findings fail the build.
3. Optionally, run a *separate* non-blocking job that lints the whole repo and reports the count — gives a "debt" trend.
4. Fix the legacy backlog opportunistically; the day the count hits zero, drop `--new-from-rev`.

```yaml
# .github/workflows/lint.yml
- name: lint changed
  run: golangci-lint run --new-from-rev=origin/${{ github.base_ref }} --out-format=github-actions

- name: lint all (informational)
  if: always()
  run: golangci-lint run --issues-exit-code=0 --out-format=json:lint-debt.json
```

`--new-from-rev` requires the full git history of the base branch in CI (`fetch-depth: 0`).

---

## 5. Version pinning is non-optional

Every new golangci-lint release does at least one of:
- Adds a new linter to a preset.
- Bumps a bundled linter (e.g., new `staticcheck` checks).
- Changes default settings.

Any of those creates *new findings* on code that previously passed. Therefore:

- **Pin in CI** (`v1.59.1`, not `latest`).
- **Pin in dev** — document the exact version in the README and Makefile.
- **Bump deliberately** — a separate PR, with the diff in findings discussed in code review.

```makefile
GOLANGCI_LINT_VERSION := v1.59.1
lint:
    @golangci-lint version | grep $(GOLANGCI_LINT_VERSION) >/dev/null \
        || (echo "wrong golangci-lint version, want $(GOLANGCI_LINT_VERSION)" && exit 1)
    golangci-lint run ./...
```

---

## 6. v1 → v2 config migration

`golangci-lint v2` reworks the config schema. Highlights:
- `linters.enable` and `linters.disable` move under a single `linters:` block with `default: standard|none|all`.
- `linters-settings` becomes `linters.settings`.
- `issues.exclude-rules` becomes `linters.exclusions.rules`.
- Per-format output keys are restructured (`output.formats` is a map).

The migrator does most of it:

```bash
golangci-lint migrate           # rewrites .golangci.yml in place
golangci-lint migrate --dry-run # preview only
```

Plan the migration as a single PR after pinning the v2 version, and re-baseline `--new-from-rev` against the new findings (typically a handful change).

---

## 7. Integrating custom linters via the `custom` section

You can plug a domain-specific linter into the same driver, config, and output pipeline:

```yaml
linters:
  enable:
    - mycorp-noprintln

linters-settings:
  custom:
    mycorp-noprintln:
      path: ./tools/linters/noprintln.so   # built as a Go plugin
      description: forbid fmt.Println in production code
      original-url: github.com/mycorp/lint/noprintln
```

The plugin must export an `AnalyzerPlugin` symbol that returns `[]*analysis.Analyzer`. v2 also supports a **plugin module** mode (no `.so` build required) where you compile a custom golangci-lint binary that bakes in your analyzers — preferred for cross-platform CI, since `.so` plugins are platform-specific and ABI-fragile.

---

## 8. Summary

The architectural value of golangci-lint is the **one-load, many-analyzers** model on top of `go/analysis`, plus a disk cache. For a large team, the corresponding discipline is: pin the version, use `disable-all` plus explicit enables, document each exclude, roll strict configs out with `--new-from-rev`, and treat the v1→v2 migration as a single planned change. Custom linters slot into the same pipeline via the `custom` section or the v2 plugin module.

---

## Further reading
- `go/analysis` framework: https://pkg.go.dev/golang.org/x/tools/go/analysis
- Plugin system: https://golangci-lint.run/plugins/
- v2 migration guide: https://golangci-lint.run/product/migration-guide/
