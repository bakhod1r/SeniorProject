# golangci-lint — Specification

> **Focus:** Precise reference for the `golangci-lint` driver — synopsis, subcommands, flags, config schema, environment, exit codes, and behavioral guarantees.
>
> **Sources:**
> - `golangci-lint --help`, `golangci-lint <cmd> --help`
> - Project docs: https://golangci-lint.run
> - Source: https://github.com/golangci/golangci-lint

This document tracks **v1.59+** behavior with notes where v2 differs.

---

## 1. Synopsis

```
golangci-lint <command> [flags] [path...]
golangci-lint run    [flags] [path...]
```

The default subject is the current Go module. `path...` accepts Go package patterns (`./...`, `./internal/api/...`) or directories.

---

## 2. Top-level commands

| Command | Purpose |
|---------|---------|
| `run` | Run enabled linters and report issues |
| `linters` | List linters (enabled/disabled, by preset) |
| `config` | Inspect or migrate `.golangci.yml` (`path`, `verify`, `migrate` in v2) |
| `cache` | Cache management (`status`, `clean`) |
| `custom` | Build a custom golangci-lint binary with extra linters (v2) |
| `version` | Print version, Go version, build info |
| `completion` | Shell completion script (`bash`, `zsh`, `fish`) |
| `help` | Help for any command |

---

## 3. Key `run` flags

| Flag | Effect |
|------|--------|
| `--enable=<l1,l2,...>` / `-E` | Enable additional linters on top of config |
| `--disable=<l1,l2,...>` / `-D` | Disable specific linters |
| `--enable-only=<l1,l2,...>` | Run **only** these linters (overrides config) |
| `--disable-all` | Disable all linters before applying `--enable` |
| `--presets=<bugs,style,...>` | Enable all linters in named presets |
| `--fast` | Run only fast linters (no type info / whole-program analysis) |
| `--new` | Report only issues in lines changed in uncommitted diff |
| `--new-from-rev=<rev>` | Report only issues new since `<rev>` (e.g., `origin/main`) |
| `--new-from-patch=<file>` | Same, but compute "new" from a patch file |
| `--fix` | Apply suggested fixes in place |
| `--out-format=<f1,f2:path,...>` | Output format(s); see §6 |
| `--config=<path>` / `-c` | Path to `.golangci.yml` (default: search up from CWD) |
| `--no-config` | Ignore any discovered config file |
| `--timeout=<dur>` | Per-run timeout (default 1m) |
| `--concurrency=<n>` / `-j` | Worker concurrency (default `NumCPU`) |
| `--issues-exit-code=<n>` | Exit code when issues are found (default 1; set 0 to make non-blocking) |
| `--max-issues-per-linter=<n>` | Cap findings per linter (default 50) |
| `--max-same-issues=<n>` | Cap repeated identical findings (default 3) |
| `--sort-results` | Sort output deterministically |
| `--allow-parallel-runners` | Allow multiple instances on the same machine |
| `-v` | Verbose logging |
| `--print-resources-usage` | Print RAM/CPU stats per linter |

---

## 4. `.golangci.yml` structure

Top-level keys (v1 schema; v2 reorganizes — see §9):

```yaml
run:                 # execution
  timeout: 5m
  concurrency: 4
  tests: true
  build-tags: [integration]
  go: "1.22"

linters:             # which linters fire
  disable-all: true
  enable: [govet, staticcheck, errcheck]
  presets: [bugs]

linters-settings:    # per-linter configuration
  gocyclo: { min-complexity: 15 }
  revive:
    rules:
      - name: exported

issues:              # filter the findings stream
  exclude-dirs: [vendor, gen]
  exclude-files: [".*\\.pb\\.go$"]
  exclude-rules:
    - path: _test\.go
      linters: [errcheck, gosec]
  exclude-use-default: true
  max-issues-per-linter: 50
  max-same-issues: 3
  new-from-rev: ""    # equivalent to --new-from-rev

severity:            # map findings to severities
  default-severity: error
  rules:
    - severity: warning
      linters: [revive, gocritic]

output:              # presentation
  formats:
    - format: colored-line-number
  print-issued-lines: true
  print-linter-name: true
  sort-results: true
```

Top-level `service:` is used by the hosted golangci.com integration and is irrelevant for self-hosted CI.

---

## 5. Linter selection precedence

From lowest to highest priority:

1. Default enabled set.
2. `linters.disable-all` / `linters.enable-all`.
3. `linters.presets`.
4. `linters.enable` / `linters.disable`.
5. Command-line `--disable-all`, `--enable`, `--disable`.
6. `--enable-only` (replaces everything above).

`--enable-only` is the kill switch: use it when you need to ignore all configuration and run exactly one linter.

---

## 6. Output formats

| Format | Use |
|--------|-----|
| `colored-line-number` (default) | Human, terminal |
| `line-number` | Human, no color (logs) |
| `tab` | Human, tab-aligned |
| `json` | Stable machine-readable, full issue records |
| `checkstyle` | Jenkins, Bitbucket, etc. |
| `code-climate` | GitLab Code Quality |
| `junit-xml` | JUnit consumers |
| `github-actions` | Inline PR annotations in GitHub Actions |
| `teamcity` | TeamCity service messages |
| `sarif` | SARIF for SAST tooling (v2) |

Multiple formats at once, each optionally to a path:

```bash
golangci-lint run --out-format=colored-line-number,json:report.json,checkstyle:report.xml
```

---

## 7. Exit codes

| Code | Meaning |
|------|---------|
| `0` | No issues found (or `--issues-exit-code=0`) |
| `1` | Issues were found (default `--issues-exit-code` value) |
| `2` | Configuration or input error (bad flag, bad YAML, unknown linter) |
| `3` | Internal failure (linter crash, package load failure, timeout) |
| `7` | Validation error in the config file (v2 distinguishes from `2`) |

Always check the exit code; do not parse stderr to determine success.

---

## 8. Environment variables

| Variable | Role |
|----------|------|
| `GOLANGCI_LINT_CACHE` | Cache directory (default `~/.cache/golangci-lint`) |
| `GOCACHE` | Go build cache (used during package load) |
| `GOPATH`, `GOMODCACHE` | Module cache for dependency loading |
| `GOPROXY`, `GOSUMDB` | Module download/verification policy |
| `GOFLAGS` | Default flags for the embedded `go` invocations |
| `GOOS`, `GOARCH` | Cross-compile target for analysis (matches build tags) |
| `CGO_ENABLED` | Affects which files are loaded based on build constraints |
| `GOMAXPROCS` | Caps concurrency in cgroup-limited environments |
| `GOLANGCI_LINT_VERBOSE` | Verbose logging (equivalent to `-v`) |

---

## 9. v1 → v2 schema notes

| v1 | v2 |
|----|----|
| `linters.enable: [...]` | `linters.enable: [...]` with `linters.default: standard\|none\|all\|fast` |
| `linters-settings:` | `linters.settings:` |
| `issues.exclude-rules:` | `linters.exclusions.rules:` |
| `issues.exclude-dirs:` | `linters.exclusions.paths:` |
| `output.format` (string) | `output.formats:` (map of name → options) |
| `service:` | removed |

Migrate with `golangci-lint migrate` (in-place) or `--dry-run`.

---

## 10. Behavioral guarantees

- **Single load.** Packages are loaded once per run; `go/analysis` analyzers share the result.
- **Deterministic with a pinned version.** Same version + same Go + same config + same source → same findings.
- **Cache safety.** Cache entries are keyed on tool/Go versions, enabled linter set, settings, and source hashes; stale entries are not returned.
- **Faithful exit code.** Returns non-zero when issues are found unless `--issues-exit-code=0`.
- **Suggested fixes are atomic per file.** `--fix` writes to a temp file and renames; partial writes do not occur.

---

## 11. Non-goals / limitations

- Not a security scanner on its own (use `gosec` as one of its linters).
- Not a code formatter (it can apply formatter linters' fixes, but pick one of `gofmt`/`gofumpt`).
- Not an IDE protocol; for editor integration use the upstream linters' LSPs or `golangci-lint`'s editor plugins.
- Not a `go vet` replacement at the language level — `go vet` ships with the Go toolchain and runs as `go test` always.
- Not reproducible across versions; pin the version.

---

## 12. Related references
- Project site: https://golangci-lint.run
- Configuration reference: https://golangci-lint.run/usage/configuration/
- Linters list: https://golangci-lint.run/usage/linters/
- v2 migration guide: https://golangci-lint.run/product/migration-guide/
- `go/analysis`: https://pkg.go.dev/golang.org/x/tools/go/analysis
