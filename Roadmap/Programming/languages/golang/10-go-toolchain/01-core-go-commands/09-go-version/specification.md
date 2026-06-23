# go version — Specification

> **Focus:** Precise reference for `go version`, binary inspection, toolchain selection, environment, and guarantees.
>
> **Sources:**
> - `go help version`
> - Go toolchains: https://go.dev/doc/toolchain
> - BuildInfo: https://pkg.go.dev/runtime/debug#ReadBuildInfo

---

## 1. Synopsis

```
go version
go version [-m] [-v] [file ...]
```

With no arguments, prints the running toolchain's version and platform. With file arguments, reports the Go version that built each Go binary.

---

## 2. Output format

```
go version go<VERSION> <GOOS>/<GOARCH>
```

Example: `go version go1.23.0 linux/amd64`. For binaries:

```
<file>: go<VERSION>
```

---

## 3. Flags

| Flag | Effect |
|------|--------|
| `-m` | Print each binary's embedded module/build information (BuildInfo) |
| `-v` | Report files that are not recognized as Go binaries (with errors) instead of silently skipping |

---

## 4. `-m` output fields (BuildInfo)

| Field | Meaning |
|-------|---------|
| `path` | The main package's import path |
| `mod` | The main module (path, version, hash) |
| `dep` | Each dependency module (path, version, hash) |
| `build` | Build settings (e.g., `-trimpath`, `CGO_ENABLED`, `GOOS`, `GOARCH`) |
| `build vcs.revision` | The VCS commit |
| `build vcs.time` | The commit timestamp |
| `build vcs.modified` | Whether the tree was dirty at build time |

This is the same data exposed by `runtime/debug.ReadBuildInfo`.

---

## 5. Toolchain selection (Go 1.21+)

The `go` command selects which toolchain to run based on, in order:

1. `GOTOOLCHAIN` (env or `go env -w`).
2. The `toolchain` directive in `go.mod`/`go.work`.
3. The `go` directive (minimum version).

| `GOTOOLCHAIN` | Behavior |
|---------------|----------|
| `auto` (default) | Use the installed toolchain unless a directive requires newer; then download & re-exec |
| `local` | Always use the installed toolchain; error if too old |
| `go1.X.Y` | Force a specific version (download if needed) |
| `path` | Use a `go` found on `PATH` |
| `<name>+auto` / `<name>+path` | A minimum with a fallback policy |

Downloaded toolchains are fetched as modules (`golang.org/toolchain`) and verified via `GOSUMDB`.

---

## 6. Relevant `go.mod` directives

```
go 1.23.0            // minimum required version (language + module behavior)
toolchain go1.23.1   // suggested toolchain to build with
```

---

## 7. Environment variables

| Variable | Role |
|----------|------|
| `GOTOOLCHAIN` | Toolchain selection policy |
| `GOOS`, `GOARCH` | Default target platform reported in the version line |
| `GOPROXY`, `GOSUMDB` | Source and verification for downloaded toolchains |
| `GOMODCACHE` | Where downloaded toolchains/modules are stored |

---

## 8. Exit codes

| Situation | Exit |
|-----------|------|
| Success | 0 |
| A file argument is not a Go binary (without `-v`) | skipped (still 0); with `-v`, reported |
| Toolchain required but unavailable (`local`, too old) | non-zero with an explanatory error |
| Invalid flags | 2 |

---

## 9. Behavioral guarantees

- **Version is embedded at build time** and readable from any Go binary, surviving symbol stripping (`-s -w`).
- **The active toolchain may differ from the installed one** when `GOTOOLCHAIN=auto` selects a newer version.
- **`-m` reflects exactly what shipped** — module versions, build flags, and VCS provenance.
- **Downloaded toolchains are checksum-verified** via the sum DB.

---

## 10. Related references
- Go toolchains: https://go.dev/doc/toolchain
- `go version -m` / BuildInfo: https://pkg.go.dev/runtime/debug#ReadBuildInfo
- `govulncheck` binary mode: https://pkg.go.dev/golang.org/x/vuln/cmd/govulncheck
- Release history: https://go.dev/doc/devel/release
