# golangci-lint — Middle

## 1. The `.golangci.yml` config file

By convention, `golangci-lint` looks for `.golangci.yml`, `.golangci.yaml`, `.golangci.toml`, or `.golangci.json` in the current directory and walks up parents. A typical file has five top-level blocks:

```yaml
run:
  timeout: 5m
  concurrency: 4
  tests: true

linters:
  disable-all: true
  enable:
    - govet
    - staticcheck
    - errcheck
    - ineffassign
    - unused
    - gosimple
    - revive
    - gocritic

linters-settings:
  gocritic:
    enabled-tags: [diagnostic, performance]

issues:
  exclude-dirs:
    - vendor
    - third_party
  exclude-rules:
    - path: _test\.go
      linters: [errcheck, gosec]

output:
  formats:
    - format: colored-line-number
```

Each block is independent: `run` is execution-level, `linters` chooses *which* linters fire, `linters-settings` configures their internals, `issues` filters the resulting findings, and `output` formats the result.

---

## 2. Enable / disable / presets

You can pick linters explicitly or by **preset** (a labeled category):

```yaml
linters:
  disable-all: true
  enable:
    - govet
    - errcheck
  presets:
    - bugs        # error-prone code
    - performance # avoidable allocs/copies
```

Presets group linters by purpose. The main ones are:

| Preset | Examples |
|--------|----------|
| `bugs` | `govet`, `staticcheck`, `errcheck`, `gosec` |
| `style` | `revive`, `stylecheck`, `gofumpt` |
| `complexity` | `gocyclo`, `gocognit`, `cyclop` |
| `performance` | `prealloc`, `perfsprint` |
| `unused` | `unused`, `unparam`, `deadcode` |
| `format` | `gofmt`, `goimports`, `gofumpt` |

Prefer `disable-all: true` + explicit `enable:` in real projects so a new release of golangci-lint cannot silently turn on additional linters and flood your CI.

---

## 3. Built-in linters by category

`golangci-lint linters` prints all of them; the table below shows the ones teams reach for most:

| Category | Linter | What it catches |
|----------|--------|----------------|
| Bugs | `govet`, `staticcheck`, `errcheck`, `gosec` | Bug-prone or insecure code |
| Style | `revive`, `stylecheck`, `gofumpt`, `goimports` | Naming, layout, imports |
| Complexity | `gocyclo`, `gocognit`, `cyclop` | Functions that exceed a complexity threshold |
| Performance | `prealloc`, `perfsprint`, `bodyclose` | Avoidable allocations, leaks |
| Duplication | `dupl` | Copy-pasted blocks |
| Idiom | `gocritic` | Many smaller "be more idiomatic" rules |

---

## 4. Adding extras safely

```yaml
linters:
  enable:
    - gocritic
    - revive
    - gosec
    - gocyclo
    - dupl
    - gocognit

linters-settings:
  gocyclo:
    min-complexity: 15
  gocognit:
    min-complexity: 20
  dupl:
    threshold: 100
  revive:
    rules:
      - name: exported
      - name: var-naming
```

Two practical rules:
1. Configure **thresholds** when enabling complexity/duplication linters — defaults are conservative.
2. Add new linters one at a time, fix or exclude, then enable the next. Bulk-enabling tends to create unmanageable noise.

---

## 5. Running specific linters

You don't always want the whole set — `--enable-only` overrides the config and runs *just* the named linters:

```bash
# Run only staticcheck (e.g., in a fast pre-commit hook)
golangci-lint run --enable-only=staticcheck ./...

# Multiple
golangci-lint run --enable-only=staticcheck,errcheck ./...
```

This is the right tool when bisecting "which linter started complaining after my refactor".

---

## 6. `--new-from-rev` — only new issues on this PR

On a legacy codebase, you cannot fix 5000 findings before turning the linter on. The escape hatch is:

```bash
golangci-lint run --new-from-rev=origin/main ./...
```

This reports **only issues introduced by commits not in `origin/main`** — i.e., your PR. Existing problems are tolerated; new ones fail the build. Variants:

```bash
# Only issues added since a specific commit
golangci-lint run --new-from-rev=abc1234

# Only issues in lines changed in uncommitted diff
golangci-lint run --new
```

This is the standard way to roll out a stricter config on a large repo without a big-bang fix.

---

## 7. Deadline and concurrency tuning

```yaml
run:
  timeout: 5m      # default 1m can be too short on big repos
  concurrency: 4   # default = NumCPU
  go: "1.22"       # tell linters which Go version to assume
```

Or via flags:

```bash
golangci-lint run --timeout=10m --concurrency=8 ./...
```

In CI containers with low CPU quotas (e.g., 2 vCPU), set `concurrency` to match the quota — otherwise the linter oversubscribes and gets slower, not faster.

---

## 8. Comparison with running each linter standalone

```bash
# Without golangci-lint
go vet ./...
staticcheck ./...
errcheck ./...
ineffassign ./...
```

Each command re-loads, re-parses, and re-type-checks every package — 4 full analyses. `golangci-lint run` does **one** load/parse/type-check and shares the result with all enabled linters via the `go/analysis` interface. On a 200-package repo that is the difference between ~30s and ~8s.

You also get one unified config for excludes, severities, and per-path rules, instead of N tool-specific config files.

---

## 9. Summary

`.golangci.yml` has five sections: `run`, `linters`, `linters-settings`, `issues`, `output`. Pick linters by name or preset, configure each in `linters-settings`, exclude noise in `issues.exclude-rules`, and tune execution with `run.timeout` and `run.concurrency`. Adopt aggressively-strict configurations on legacy code via `--new-from-rev=origin/main`. Versus running each linter standalone, you trade a config file for one shared analysis pass that is several times faster.

---

## Further reading
- Configuration reference: https://golangci-lint.run/usage/configuration/
- Linters list: https://golangci-lint.run/usage/linters/
- False positives and excludes: https://golangci-lint.run/usage/false-positives/
