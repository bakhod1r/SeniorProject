# govulncheck — Specification

> **Focus:** Precise reference for the `govulncheck` command — synopsis, modes, flags, environment, output formats, exit codes, and behavioral guarantees.
>
> **Sources:**
> - `govulncheck -h`
> - Tool reference: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
> - Source: https://github.com/golang/vuln
> - OSV schema: https://ossf.github.io/osv-schema/
> - Go vuln DB: https://vuln.go.dev/

---

## 1. Synopsis

```
govulncheck [flags] [patterns]
govulncheck [flags] -mode=binary [flags] binary_path
govulncheck [flags] -mode=extract [flags] binary_path
```

`govulncheck` reports known vulnerabilities that affect Go code, scoped to those actually reachable from the analyzed program. It uses the Go vulnerability database (OSV format) at `vuln.go.dev` by default.

---

## 2. Modes

| Mode | Argument | Behavior |
|------|----------|----------|
| `source` (default) | One or more package patterns (`./...`, `./cmd/...`) | Loads packages via `go/packages`, builds SSA, computes a call graph, intersects reached symbols with OSV records |
| `binary` | A single binary path | Reads `runtime/debug.BuildInfo` and the binary's symbol table, intersects present symbols with OSV records |
| `extract` | A single binary path | Emits the binary's module + symbol info as JSON for offline scanning (separate matching step) |

Select with `-mode=source|binary|extract`. Source mode requires being inside a Go module; binary mode does not.

---

## 3. Arguments

| Form | Meaning |
|------|---------|
| `./...` | Source mode: scan all packages in the current module |
| `./cmd/server/...` | Source mode: scan a subtree |
| `path/to/binary` | Binary/extract mode: scan a compiled artifact |
| (empty) | Source mode against the current directory |

Package patterns follow the same conventions as `go build`/`go list`. A list of patterns is allowed.

---

## 4. Flags

| Flag | Default | Effect |
|------|---------|--------|
| `-mode` | `source` | Scan mode: `source`, `binary`, or `extract` |
| `-show` | (none) | Comma-separated extra output: `traces`, `verbose`, `color` |
| `-format` | `text` | Output format: `text`, `json`, `sarif`, `openvex` |
| `-test` | `false` | In source mode, include `_test.go` files in analysis |
| `-tags` | "" | Build tags (comma-separated) to apply during source-mode loading |
| `-C` | "" | Change to the given directory before running (analogous to `go build -C`) |
| `-scan` | `symbol` | Granularity: `symbol`, `package`, or `module` (coarser is faster, less precise) |
| `-version` | — | Print scanner and Go version, then exit |
| `-h`, `-help` | — | Print help |

Boolean flags accept `-flag=true|false`. Flags must appear before positional arguments.

---

## 5. Environment variables

| Variable | Role |
|----------|------|
| `GOVULNDB` | Vulnerability database URL (default: `https://vuln.go.dev`). Comma-separated for multiple sources (version-dependent) |
| `GOPROXY` | Go module proxy used when source mode resolves dependencies |
| `GOFLAGS` | Default flags applied to underlying `go` invocations (e.g., `-mod=readonly`) |
| `GOMODCACHE` | Module cache location consulted by source mode |
| `GOCACHE` | Build cache; source mode reuses compiled packages from it |
| `GOSUMDB` | Module checksum DB; affects module download verification |
| `HTTPS_PROXY`, `NO_PROXY` | Honored by the DB HTTP client |

---

## 6. Output formats

### 6.1 `text` (default)

Human-readable. One block per vulnerability with module info, affected/fixed versions, and one example trace by default (full traces with `-show=traces`).

### 6.2 `json`

A JSON stream (newline-delimited objects). Each object has a top-level discriminator:

| Top-level key | Payload |
|---------------|---------|
| `config` | Scan configuration (tool version, db URL, mode, patterns) |
| `progress` | Free-form progress message |
| `osv` | A full OSV record for a vulnerability that may be relevant |
| `finding` | A concrete finding: `osv`, `fixed_version`, `trace` (caller chain), and metadata |

Typical finding shape:

```json
{
  "finding": {
    "osv": "GO-2024-2598",
    "fixed_version": "v1.21.8",
    "trace": [
      {"module": "stdlib", "version": "v1.21.0", "package": "net/http",
       "function": "Server.Serve", "position": {...}},
      {"module": "example.com/app", "package": "main",
       "function": "main", "position": {"filename": "main.go", "line": 42}}
    ]
  }
}
```

### 6.3 `sarif`

Static Analysis Results Interchange Format. Suitable for GitHub code-scanning (`github/codeql-action/upload-sarif`) and other SARIF consumers.

### 6.4 `openvex`

OpenVEX statements for supply-chain attestations: declares each module's status (`affected`, `not_affected`, `fixed`) with optional justification.

---

## 7. Exit codes

| Code | Meaning |
|------|---------|
| `0` | Scan completed; no vulnerabilities found |
| `1` | Invalid arguments or initialization error |
| `2` | Scan error during execution (I/O, parse, network) |
| `3` | Scan completed; one or more vulnerabilities found |

CI must distinguish `3` from `1`/`2`. A `set -e` script that treats any non-zero as a failure conflates "vulns found" with "tool broke."

---

## 8. Behavioral guarantees

- **Reachability-only by default.** Source mode reports a finding only when the call graph from a main entry point reaches a vulnerable symbol. Binary mode reports only when the symbol is present in the binary.
- **OSV-based.** Vulnerabilities are drawn from the OSV-format Go vuln DB; nothing outside the DB is detected.
- **Module-aware.** Source mode requires `go.mod`; binary mode requires `runtime/debug.BuildInfo` embedded by Go 1.18+.
- **Idempotent.** Two runs of the same code against the same DB produce identical findings.
- **Deterministic ordering.** JSON output ordering is stable for the same inputs.
- **No code mutation.** `govulncheck` does not modify your source, `go.mod`, or any artifact.

---

## 9. Non-goals / limitations

- **Not an SCA for non-Go dependencies.** C libraries, OS packages, container layers are out of scope. Use Trivy, `osv-scanner`, or platform tooling for those.
- **No license scanning.** `govulncheck` does not enforce or report on licenses.
- **No runtime detection.** It does not observe a running process or detect misconfiguration; it is static.
- **No automatic remediation.** It does not edit `go.mod` to bump versions. Pair with `go get`/`go mod tidy`.
- **No built-in suppression mechanism.** Allowlisting is intentionally external (see Senior notes).
- **Limited handling of reflection.** Dynamic dispatch via reflection or `interface{}` indirection is over-approximated by the call-graph algorithm; results may include reachable-but-unexercised symbols.

---

## 10. Related references
- Tool docs: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Library API for embedding (`scan.Command`): https://pkg.go.dev/golang.org/x/vuln/scan
- Vuln DB design: https://go.dev/security/vuln/database
- OSV schema: https://ossf.github.io/osv-schema/
- `runtime/debug.ReadBuildInfo`: https://pkg.go.dev/runtime/debug#ReadBuildInfo
- SARIF spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
- OpenVEX: https://openvex.dev/
