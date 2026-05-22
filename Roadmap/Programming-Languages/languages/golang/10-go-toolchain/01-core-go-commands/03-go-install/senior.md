# go install — Senior

## 1. The two modes precisely

`go install` operates in one of two modes depending on whether a version is given:

- **`go install path@version`** — *isolated module mode.* Go ignores any `go.mod` in the current directory, resolves the tool's own module graph, builds it, and installs the binary. Your project's dependencies are irrelevant; the tool builds with its own pinned deps. This is the modern, recommended way to install tools.
- **`go install [packages]`** (no version) — *current-module mode.* Builds the named local main packages using your module's `go.mod` and installs them. Used for your own commands.

Mixing the two — e.g., expecting `go install ./cmd/x` to use a different version of a dependency than your `go.mod` specifies — does not work; that path uses your build list.

---

## 2. Reproducibility of tool installs

`@latest` is a moving target: it re-resolves on each invocation and can silently upgrade a tool, changing lint output or generator behavior. For anything shared (CI, team scripts, `go:generate`), pin exact versions:

```bash
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1   # reproducible
```

To audit what is installed:

```bash
go version -m "$(go env GOPATH)/bin/staticcheck"
# prints path, mod version, build settings (-trimpath, vcs, etc.)
```

The version embedded in the binary is the source of truth, not your shell history.

---

## 3. GOBIN, GOPATH, and where things really go

```bash
go env GOBIN          # explicit destination (highest priority)
go env GOPATH         # fallback: $GOPATH/bin
```

Subtleties:
- `GOBIN` must point to a single directory; it cannot be a list.
- Cross-compiled installs (`GOOS`/`GOARCH` differ from host) go to `$GOPATH/bin/<goos>_<goarch>/` to avoid clobbering the native binary.
- `GOBIN` overrides that per-arch subdirectory behavior — set it deliberately when cross-installing.

```bash
GOOS=linux GOARCH=arm64 go install ./cmd/tool   # → $GOPATH/bin/linux_arm64/tool
```

---

## 4. Caching and rebuild behavior

`go install` shares `GOCACHE`. For a fixed `@vX.Y.Z`, the second install is a cache hit and the binary copy is a no-op if already present and unchanged. For `@latest`, Go always performs a version query (a network round trip to the proxy/VCS) even if nothing changed; the *build* may still be cached if the resolved version is unchanged.

Implication: in a tight CI loop, prefer pinned versions both for reproducibility and to avoid repeated proxy lookups.

---

## 5. Where it surprises people

- **No `-o`.** Unlike `go build`, you cannot rename the output; the name is the last path element. Rename after, or use `go build -o`.
- **`@version` ignores local `go.mod`.** People expect the tool to honor their project's dependency versions — it does not.
- **`@latest` excludes pre-releases** (unless only pre-releases exist) and respects retractions/`exclude` only of the **tool's** module, not yours.
- **Cross-arch subdirectory.** Cross-installed binaries land in `bin/<os>_<arch>/`, surprising people who expect them in `bin/`.
- **No uninstall.** Removing a tool means deleting the file manually.
- **`GOFLAGS` leakage.** A global `GOFLAGS=-mod=vendor` can break `@version` installs (which want module mode); installs may need `-mod=mod` or unsetting `GOFLAGS`.

---

## 6. CI usage

Two patterns coexist:

**Install once, use by name:**

```bash
export GOBIN="$PWD/bin"; export PATH="$GOBIN:$PATH"
go install honnef.co/go/tools/cmd/staticcheck@v0.5.1
staticcheck ./...
```

**Run without installing (no PATH management):**

```bash
go run honnef.co/go/tools/cmd/staticcheck@v0.5.1 ./...
```

Use `go install` when the same tool is invoked many times in a job (amortize the build) and `go run` for a single invocation. Cache `GOBIN`, `GOCACHE`, and `GOMODCACHE` to keep installs fast.

---

## 7. Provenance and supply chain

`go install path@version` downloads and **executes build steps** of third-party code. Senior hygiene:

- Pin exact versions; treat `@latest` as untrusted drift.
- Route through a controlled `GOPROXY` and enforce `GOSUMDB`/`go.sum` so installs are verifiable.
- Inspect installed binaries with `go version -m` to confirm version and build settings.
- For maximal control, vendor tools or build them in a sandboxed CI step with network egress restrictions.

---

## 8. Installing your own multi-command repo

```bash
go install ./cmd/...          # installs every main package under cmd/
```

This is the canonical local install for a repo with several CLIs. Each binary is named after its `cmd/<name>` directory. Combine with build stamping:

```bash
go install -trimpath -ldflags="-s -w -X main.version=$(git describe --tags)" ./cmd/...
```

---

## 9. Summary

`go install` has two modes: isolated `path@version` (ignores your `go.mod`, builds the tool with its own deps — the modern way to install tools) and local `[packages]` (uses your module). It places named binaries in `GOBIN` or `$GOPATH/bin`, with cross-arch installs going to a per-arch subdirectory. There is no `-o` and no uninstall. Pin exact versions for reproducibility and supply-chain safety, audit with `go version -m`, and cache the relevant directories in CI.

---

## Further reading
- `go install` reference: https://go.dev/ref/mod#go-install
- Version queries: https://go.dev/ref/mod#version-queries
- `go version -m`: https://pkg.go.dev/cmd/go#hdr-Print_Go_version
