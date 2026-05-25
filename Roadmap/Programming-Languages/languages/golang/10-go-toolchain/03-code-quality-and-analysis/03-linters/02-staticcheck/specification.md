# staticcheck — Specification

> **Focus:** Precise reference for the `staticcheck` CLI — synopsis, flags, configuration, environment, exit behavior, and guarantees.
>
> **Sources:**
> - `staticcheck -help`, `staticcheck -explain <ID>`
> - Project docs: https://staticcheck.dev/docs/
> - Source: https://github.com/dominikh/go-tools

---

## 1. Synopsis

```
staticcheck [flags] [packages]
staticcheck -explain <CheckID>
staticcheck -version
```

`staticcheck` runs the active set of analyzers against the named Go packages and prints diagnostics to stdout. With no package argument, behavior matches `go vet` and other Go tools: an error.

---

## 2. Package selectors

| Form | Meaning |
|------|---------|
| `./...` | All packages in the current module/working tree |
| `./pkg/...` | All packages under `./pkg` |
| `./internal/auth` | A single relative package |
| `example.com/mod/pkg` | A package by import path |

Standard Go package-pattern rules apply (same as `go build` / `go test`).

---

## 3. Selection flags

| Flag | Effect |
|------|--------|
| `-checks <list>` | Comma-separated list of check ID patterns. Supports `*`, `-` (exclude). Examples: `all`, `SA*`, `all,-ST*`, `inherit` (from config). |
| `-tags <list>` | Apply build constraints (e.g., `-tags=integration`). |
| `-tests` | Include test files (default `true`). Set `-tests=false` to skip `_test.go`. |
| `-go <version>` | Target Go version semantics (e.g., `-go 1.22`). Affects deprecation and stdlib-availability checks. |
| `-matrix` | Run with multiple target configurations and merge results (advanced). |

---

## 4. Output flags

| Flag | Effect |
|------|--------|
| `-f text` (default) | Plain `file:line:col: msg (ID)` format. |
| `-f stylish` | Slightly nicer human format, grouped by file. |
| `-f json` | One JSON object per diagnostic; for tooling. |
| `-f sarif` | SARIF 2.1.0 output for GitHub code scanning, Azure DevOps, etc. |
| `-f binary` | Internal serialization (rarely used directly). |
| `-fail <list>` | Same syntax as `-checks`; only listed IDs cause non-zero exit. |
| `-set_exit_status` | Exit non-zero if any diagnostics were emitted (deprecated synonym kept for compatibility). |

---

## 5. Introspection flags

| Flag | Effect |
|------|--------|
| `-explain <ID>` | Print the description, motivation, and example for a check ID, then exit. |
| `-list-checks` | Print all available check IDs and their default status, then exit. |
| `-version` | Print staticcheck version and Go toolchain version. |

---

## 6. Debug flags

| Flag | Effect |
|------|--------|
| `-debug.cpuprofile <file>` | Write CPU profile of the analysis run. |
| `-debug.memprofile <file>` | Write heap profile. |
| `-debug.max-concurrent-jobs <n>` | Cap parallelism (default `GOMAXPROCS`). |
| `-debug.measure-analyzers <file>` | Write per-analyzer wall-time measurements. |
| `-debug.no-compile-errors` | Continue on type/compile errors instead of aborting. |
| `-debug.unused-graph <file>` | Dump the `unused` analyzer's reachability graph (used for upstream bug reports). |

---

## 7. Configuration file: `staticcheck.conf`

A TOML file at the module root (or any package directory) sets per-project defaults. Nested configs override parents for their subtree.

```toml
checks = ["all", "-ST1000", "-ST1003"]
initialisms = ["ACL", "API", "ASCII", "CPU", "CSS", "DNS", "EOF",
               "GUID", "HTML", "HTTP", "HTTPS", "ID", "IP", "JSON",
               "QPS", "RAM", "RPC", "SLA", "SMTP", "SQL", "SSH",
               "TCP", "TLS", "TTL", "UDP", "UI", "GID", "UID", "UUID",
               "URI", "URL", "UTF8", "VM", "XML", "XMPP", "XSRF", "XSS"]
dot_import_whitelist = ["github.com/example/dsl"]
http_status_code_whitelist = ["200", "400", "404", "500"]
```

Keys:

| Key | Type | Purpose |
|-----|------|---------|
| `checks` | `[]string` | Active check IDs/patterns (same syntax as `-checks`) |
| `initialisms` | `[]string` | Accepted all-caps identifiers for `ST1003` |
| `dot_import_whitelist` | `[]string` | Packages allowed to be dot-imported (`ST1001`) |
| `http_status_code_whitelist` | `[]string` | Numeric status codes allowed instead of `http.StatusX` constants (`ST1013`) |

When `-checks=inherit` is passed (the implicit default if no `-checks` is given), the CLI reads the config file from the package tree.

---

## 8. Suppression directives

| Directive | Scope |
|-----------|-------|
| `//lint:ignore SA1234 reason` | Suppress one ID on the next statement |
| `//lint:ignore SA1234,SA5678 reason` | Suppress multiple IDs on the next statement |
| `//lint:file-ignore SA1234 reason` | Suppress one ID for the whole file (placed at top) |

Reasons are not enforced by the tool but are mandatory by convention; reviewers should reject ignores without one.

---

## 9. Check ID grammar

```
<prefix><number>
```

| Prefix | Family | Catalog reference |
|--------|--------|-------------------|
| `SA` | Static analysis (likely bugs) | `SA1000`–`SA9999` |
| `S` | Simplifications | `S1000`+ |
| `ST` | Style checks | `ST1000`+ |
| `U` | Unused code | `U1000`+ |
| `QF` | Quickfixes (IDE) | `QF1000`+ |

IDs are stable across releases — once published, an ID's meaning does not change. New checks get new IDs.

---

## 10. Environment variables

| Variable | Role |
|----------|------|
| `GOCACHE` | Reused by staticcheck for type-check artifacts |
| `GOFLAGS` | Affects underlying `go/packages` calls (e.g., `-mod=readonly`) |
| `GOOS`, `GOARCH` | Target platform for analysis (cross-platform analysis) |
| `CGO_ENABLED` | Affects which files are analyzed when constrained by build tags |
| `GOMAXPROCS` | Default for `-debug.max-concurrent-jobs` |
| `XDG_CACHE_HOME` / `HOME` | Locates staticcheck's own cache (`$XDG_CACHE_HOME/staticcheck` or `~/.cache/staticcheck`) |
| `GOPROXY`, `GOSUMDB` | Module resolution when packages are not already cached |

---

## 11. Exit codes

| Situation | Exit |
|-----------|------|
| No flags requesting exit status; diagnostics were emitted | `0` (default historical behavior) |
| `-set_exit_status` and any diagnostics emitted | `1` |
| `-fail <pattern>` matched any emitted diagnostic | `1` |
| Compile/type errors in input packages | non-zero (typically `1`) before analysis runs |
| Invocation error (bad flag, unknown ID for `-explain`) | `2` |

---

## 12. Behavioral guarantees

- **Stable IDs.** A check ID's semantics do not change across releases. New checks get new IDs.
- **Cache correctness.** Cache keys include the staticcheck version, Go toolchain version, source hashes, and relevant flags; correctness does not depend on cache hygiene.
- **No mutation.** staticcheck does **not** modify source files. Quickfixes are surfaced via `gopls`, not applied by the CLI.
- **Faithful `go/packages` loading.** Build tags, module resolution, and version handling match `go build`/`go test`.
- **Cross-package facts.** `SA1019` and similar checks propagate facts (e.g., `// Deprecated:`) across package boundaries via the `go/analysis` framework.

---

## 13. Non-goals / limitations

- Not a code formatter (use `gofmt` / `goimports`).
- Not a security scanner (no taint analysis, no CVE matching; use `govulncheck` for vulnerable-dependency scanning).
- Not a SAST replacement (no IaC, secrets, SQLi, or input-flow detection beyond what `SA` checks cover).
- Does not auto-apply fixes from the CLI (use `gopls` for `QF` quickfixes in an editor).
- `unused` cannot judge exported symbols in library packages — only unexported ones, or exported ones in `main` packages, are reliable signals.
- Analysis is sound modulo language features that defeat static reasoning (reflection, `unsafe`, build-tag combinations not analyzed).

---

## 14. Related references
- Check catalog: https://staticcheck.dev/docs/checks/
- Configuration: https://staticcheck.dev/docs/configuration/
- Running staticcheck: https://staticcheck.dev/docs/running-staticcheck/
- `go/analysis`: https://pkg.go.dev/golang.org/x/tools/go/analysis
- Source: https://github.com/dominikh/go-tools
