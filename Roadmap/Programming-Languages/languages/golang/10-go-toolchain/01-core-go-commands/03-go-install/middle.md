# go install — Middle

## 1. Where binaries land (the rules)

`go install` chooses the destination in this order:

1. `GOBIN` if set → install there.
2. Otherwise `$GOPATH/bin` (and `GOPATH` defaults to `$HOME/go`).

```bash
go env GOBIN GOPATH
GOBIN=/usr/local/bin go install .       # install to a specific dir for this command
```

The executable name defaults to the **last element of the package path** (`.../cmd/server` → `server`). There is no `-o` for `go install`; if you need a custom name, use `go build -o` or rename afterward.

---

## 2. The `@version` form (module-aware install)

Modern Go installs remote tools without touching your project's `go.mod`:

```bash
go install example.com/cmd/tool@latest    # newest released version
go install example.com/cmd/tool@v1.4.2     # exact version
go install example.com/cmd/tool@v1         # latest v1.x
go install example.com/cmd/tool@master     # a branch (resolves to a pseudo-version)
go install example.com/cmd/tool@none       # (only meaningful in some contexts; generally use a version)
```

Key behavior: with `@version`, the install runs in **module mode ignoring the current directory's `go.mod`**. It builds the tool with the tool's own dependencies, not yours. This isolates tool installs from your project.

---

## 3. Installing from your own module

Inside your module you can install your commands without a version suffix:

```bash
go install ./cmd/...        # install every main package under cmd/
go install ./cmd/server     # install one
```

These respect your module's dependency versions (from `go.mod`). This is how you install your own CLIs locally.

---

## 4. Version selection semantics

- `@latest` resolves to the highest release tag (excluding pre-releases unless none exist).
- `@v1.2.3` is exact and reproducible.
- A branch/commit (`@main`, `@<sha>`) produces a pseudo-version like `v0.0.0-20240101000000-abcdef123456`.
- For tools, **prefer exact versions** in shared scripts/CI for reproducibility; reserve `@latest` for ad-hoc local installs.

Confirm what got installed:

```bash
go version -m "$(go env GOPATH)/bin/staticcheck"
```

This prints the module path and version baked into the binary.

---

## 5. Build flags apply

`go install` accepts the same build flags as `go build`:

```bash
go install -ldflags="-s -w" ./cmd/server
go install -tags=prod ./cmd/server
go install -trimpath example.com/cmd/tool@v1.0.0
```

This is useful when installing your own tools with version stamping or stripped symbols.

---

## 6. How it fits the workflow

- **Developer tooling:** install linters/generators once, run by name (`staticcheck ./...`).
- **Local CLI development:** `go install ./cmd/...` to test your own command end-to-end as users would invoke it.
- **`go:generate`:** sometimes pre-install generators with `go install`, though `go run tool@version` avoids the install step.

A team trade-off: `go install tool@version` puts a tool on your machine globally, while `go run tool@version` runs it without installing. Installed tools are faster to invoke (no resolve each time) but must be kept in sync across the team.

---

## 7. Caching and reinstalls

`go install` shares the build cache, so reinstalling an unchanged version is fast (or a no-op for the binary copy). Reinstalling `@latest` re-resolves the version each time, which may or may not actually rebuild depending on whether a newer release exists.

```bash
go install tool@latest      # re-checks for a newer version on each run
go install tool@v1.2.3      # cached after first install
```

---

## 8. GOBIN vs GOPATH/bin in CI

CI commonly sets `GOBIN` to a known directory and adds it to `PATH`:

```bash
export GOBIN="$PWD/bin"
export PATH="$GOBIN:$PATH"
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
staticcheck ./...
```

This keeps tool binaries in a predictable, cacheable location.

---

## 9. Trade-offs summary

| Concern | `go install` | `go run tool@version` |
|---------|-------------|------------------------|
| Leaves a binary | Yes (in GOBIN) | No |
| Invocation speed | Fast (already built) | Slower (resolve/build each run) |
| Team sync | Must align installed versions | Version pinned per invocation |
| `go.mod` impact | None with `@version` | None with `@version` |

---

## 10. Summary

`go install` builds a `main` package and places the named binary in `GOBIN` (or `$GOPATH/bin`). The `@version` form installs remote tools in isolated module mode without touching your `go.mod`; prefer exact versions for reproducibility. It accepts build flags, shares the cache, and is the standard way to put developer tools on your `PATH`. For one-off invocations, `go run tool@version` avoids leaving a binary behind.

---

## Further reading
- `go help install`
- Module-aware install: https://go.dev/ref/mod#go-install
- Version queries: https://go.dev/ref/mod#version-queries
