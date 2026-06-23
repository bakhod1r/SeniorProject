# go mod — Specification

> **Focus:** Precise reference for `go mod` subcommands, the module files, version selection, environment, and guarantees.
>
> **Sources:**
> - `go help mod`
> - Modules reference: https://go.dev/ref/mod
> - cmd/go: https://pkg.go.dev/cmd/go

---

## 1. Synopsis

```
go mod <subcommand> [arguments]
```

| Subcommand | Synopsis |
|------------|----------|
| `init` | `go mod init [module-path]` |
| `tidy` | `go mod tidy [-go=version] [-compat=version] [-v]` |
| `download` | `go mod download [-x] [-json] [modules]` |
| `verify` | `go mod verify` |
| `vendor` | `go mod vendor [-v] [-o dir]` |
| `edit` | `go mod edit [editing flags] [go.mod]` |
| `graph` | `go mod graph [-go=version]` |
| `why` | `go mod why [-m] [-vendor] packages...` |

Adding/upgrading dependency versions is done with `go get`, not `go mod`.

---

## 2. The `go.mod` file

| Directive | Meaning |
|-----------|---------|
| `module path` | The module's import prefix |
| `go x.y.z` | Minimum Go version; controls language features and graph pruning |
| `toolchain goX.Y.Z` | Suggested toolchain (works with `GOTOOLCHAIN`) |
| `require path version` | A required dependency (with optional `// indirect`) |
| `exclude path version` | Exclude a version from selection |
| `replace old => new` | Override a module path/version (main module only) |
| `retract version[, range]` | Mark the module's own versions as withdrawn |
| `tool path` | (Go 1.24+) declare a tool dependency |

---

## 3. The `go.sum` file

Two lines per module version: a hash of the module zip (`h1:...`) and a hash of its `go.mod`. Used to verify downloads against recorded checksums. Managed by the toolchain; committed to VCS.

---

## 4. Version selection (MVS)

Go uses **Minimal Version Selection**: the selected version of each module is the highest version named in any `require` across the module graph. The result is deterministic; no range solving. `go list -m all` prints the resulting build list.

Graph pruning (with `go 1.17`+) records enough transitive requirements in `go.mod` that the full graph need not be loaded for building the main module's packages.

---

## 5. `go mod edit` flags

| Flag | Effect |
|------|--------|
| `-require=path@version` | Add/replace a require |
| `-droprequire=path` | Remove a require |
| `-exclude=path@version` / `-dropexclude` | Manage excludes |
| `-replace=old[@v]=new[@v]` / `-dropreplace` | Manage replaces |
| `-retract=version` / `-dropretract` | Manage retractions |
| `-go=version` | Set the `go` directive |
| `-toolchain=name` | Set the `toolchain` directive |
| `-json` | Print `go.mod` as JSON |
| `-print` | Print the result without writing |

---

## 6. `-mod` modes

| Mode | Behavior |
|------|----------|
| `readonly` (default) | Build fails if `go.mod`/`go.sum` would change |
| `mod` | Allow updates to `go.mod`/`go.sum` |
| `vendor` | Use `vendor/`, ignore network/cache (auto when `vendor/` present and `go` ≥ 1.14) |

---

## 7. Environment variables

| Variable | Role |
|----------|------|
| `GOMODCACHE` | Module cache location (default `$GOPATH/pkg/mod`) |
| `GOPROXY` | Module proxy URL list (`...,direct`, `off`) |
| `GOSUMDB` | Checksum database (default `sum.golang.org`; `off` disables) |
| `GOPRIVATE` | Glob patterns of private modules (skip proxy + sum DB) |
| `GONOSUMCHECK`/`GONOSUMDB`/`GOINSECURE` | Finer-grained checksum/insecure controls |
| `GOFLAGS` | Default flags (e.g., `-mod=readonly`) |
| `GOTOOLCHAIN` | Toolchain selection |

---

## 8. Exit codes

| Situation | Exit |
|-----------|------|
| Success | 0 |
| Network/resolution/verification failure | non-zero, error to stderr |
| `-mod=readonly` and changes needed | non-zero with guidance |
| Invalid flags | 2 |

---

## 9. Behavioral guarantees

- **Deterministic builds** from the module graph + MVS; `go.sum` adds integrity.
- **`tidy` is idempotent** on a clean tree (a no-op).
- **`replace` is main-module-only**; consumers ignore a dependency's replaces.
- **`go.sum` verification** runs on download against recorded hashes (and the sum DB for new entries unless excluded).
- **Pruned graph** with `go 1.17`+ self-contained in `go.mod`.

---

## 10. Related references
- Modules reference (MVS, pruning, sum DB): https://go.dev/ref/mod
- Managing dependencies: https://go.dev/doc/modules/managing-dependencies
- Workspaces (`go.work`): https://go.dev/doc/tutorial/workspaces
- `go help goproxy`, `go help private`
