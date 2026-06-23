# go install — Specification

> **Focus:** Precise reference for `go install` — synopsis, modes, destinations, flags, environment, and guarantees.
>
> **Sources:**
> - `go help install`
> - `go install` reference: https://go.dev/ref/mod#go-install
> - cmd/go documentation: https://pkg.go.dev/cmd/go

---

## 1. Synopsis

```
go install [build flags] [packages]
go install [build flags] packages@version
```

Compiles and installs the named `main` packages' executables into the install directory. Non-`main` packages are compiled (cached) but produce no installed artifact.

---

## 2. Two modes

| Mode | Trigger | Resolution |
|------|---------|------------|
| **Current-module** | `go install [packages]` (no version) | Uses the current module's `go.mod` and build list |
| **Isolated module** | `go install packages@version` | Ignores the current `go.mod`; resolves the named module's own graph |

The `@version` form requires the package to be a command (`main`). Multiple packages may be installed if they share the same module/version in the `@version` form.

---

## 3. Install destination

Selection order:

1. `GOBIN`, if set (a single directory).
2. Otherwise `$GOPATH/bin` (`GOPATH` defaults to `$HOME/go`).

Cross-compiled installs (host `GOOS`/`GOARCH` differ from target) go to `$GOPATH/bin/<goos>_<goarch>/`, unless `GOBIN` is set, which always takes precedence.

The executable name is the **last element of the package import path**. There is no `-o` flag.

---

## 4. Version queries (`@version`)

| Query | Meaning |
|-------|---------|
| `@vX.Y.Z` | Exact released version |
| `@vX` / `@vX.Y` | Highest matching version |
| `@latest` | Highest release version (excludes pre-releases unless none exist) |
| `@upgrade` / `@patch` | Relative upgrades (context-dependent) |
| `@<branch>` / `@<commit>` | Resolves to a pseudo-version |

See the modules reference for the full version-query grammar.

---

## 5. Build flags

`go install` accepts the same build flags as `go build`, including `-tags`, `-ldflags`, `-gcflags`, `-trimpath`, `-race`, `-mod`, `-p`, `-v`, `-x`, `-a`. Flags precede the package arguments.

---

## 6. Environment variables

| Variable | Role |
|----------|------|
| `GOBIN` | Explicit install directory (highest priority) |
| `GOPATH` | Fallback bin location (`$GOPATH/bin`) |
| `GOOS`, `GOARCH` | Target platform; affects install subdirectory |
| `GOCACHE` | Build cache |
| `GOMODCACHE` | Module cache for `@version` resolution |
| `GOPROXY`, `GOSUMDB` | Download and checksum policy |
| `GOFLAGS` | Default flags (may conflict with `@version`, e.g., `-mod=vendor`) |
| `GOTOOLCHAIN` | Toolchain selection |

---

## 7. Exit codes

| Situation | Exit |
|-----------|------|
| Successful install | 0 |
| Compile/link/resolution error | non-zero, diagnostics to stderr |
| Missing `@version` for an out-of-module package | non-zero with an explanatory error |
| Invalid flags | 2 |

---

## 8. Behavioral guarantees

- **`@version` isolation.** The install ignores the current directory's `go.mod` and uses the tool's own dependency versions.
- **Cached.** Shares `GOCACHE`; pinned versions reinstall as cache hits / no-ops.
- **Deterministic with pinned versions.** `@vX.Y.Z` plus a pinned toolchain yields reproducible binaries; `@latest` does not.
- **No uninstall.** Removing a tool requires deleting the file manually.
- **Library packages produce no artifact.** Only `main` packages install an executable.

---

## 9. Related references
- Modules: version queries — https://go.dev/ref/mod#version-queries
- Go 1.24 tool directives — https://go.dev/doc/modules/managing-dependencies
- `go version -m` — https://pkg.go.dev/cmd/go#hdr-Print_Go_version
- Environment — `go help environment`
