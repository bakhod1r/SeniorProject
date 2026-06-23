# Setting Up the Go Environment — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is the difference between GOPATH and Go modules?

**Answer:**
GOPATH was the original workspace model where all Go code lived under a single directory (`$GOPATH/src/`). Go modules, introduced in Go 1.11 and default since Go 1.16, allow each project to have its own `go.mod` file that defines the module path and dependencies. Go modules are the modern standard — new projects should always use modules.

---

### 2. How do you install Go and verify the installation?

**Answer:**
1. Download the binary archive from [go.dev/dl](https://go.dev/dl/)
2. Extract to `/usr/local/go` (Linux/macOS) or run the installer (Windows)
3. Add `/usr/local/go/bin` to your PATH
4. Verify with `go version`

```bash
go version
# Output: go version go1.23.0 linux/amd64
```

---

### 3. What files does `go mod init` create and what do they contain?

**Answer:**
`go mod init <module-path>` creates a `go.mod` file that contains:
- The module path (e.g., `github.com/user/project`)
- The Go version directive (minimum Go version)
- Dependencies added later via `go mod tidy`

When dependencies are downloaded, a `go.sum` file is also created containing cryptographic checksums of all dependencies for verification.

```bash
go mod init github.com/user/myapp
cat go.mod
# module github.com/user/myapp
# go 1.23
```

---

### 4. What is the difference between `go run` and `go build`?

**Answer:**
- `go run main.go` compiles the code to a temporary directory and runs it immediately. The binary is deleted after execution.
- `go build -o myapp .` compiles the code and writes a permanent binary to the specified path. You run it separately.

Use `go run` for quick testing; use `go build` for deployment and when you need a standalone executable.

---

### 5. What is GOROOT and when would you need to change it?

**Answer:**
GOROOT points to the directory where Go is installed (e.g., `/usr/local/go`). It contains the compiler, linker, standard library, and other tools. You rarely need to change it — only if you installed Go to a non-standard location. Most developers never touch GOROOT; the `go` binary figures it out automatically.

---

### 6. How do you add an external dependency to a Go project?

**Answer:**
1. Add an import statement in your Go code
2. Run `go mod tidy` — this downloads the dependency, adds it to `go.mod`, and updates `go.sum`

```bash
# Or explicitly get a specific version:
go get github.com/gin-gonic/gin@v1.9.1
```

---

### 7. What command formats Go code according to the standard style?

**Answer:**
`gofmt -w .` formats all Go files in the current directory. The Go standard library and all major projects use `gofmt` formatting. Most IDEs (VS Code, GoLand) run `gofmt` automatically on save. There is also `goimports` which does everything `gofmt` does plus manages imports.

---

## Middle Level

### 4. How would you set up a CI/CD pipeline for a Go project?

**Answer:**
A production CI/CD pipeline should include:
1. **Linting:** `golangci-lint run ./...` (runs 50+ linters)
2. **Static analysis:** `go vet ./...` (catches common mistakes)
3. **Testing:** `go test -race -coverprofile=coverage.out ./...` (with race detection)
4. **Vulnerability scanning:** `govulncheck ./...` (checks for known CVEs)
5. **Building:** `CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o app ./cmd/server`
6. **Docker:** Multi-stage build with distroless base image

Key CI considerations:
- Cache `~/.cache/go-build` and `~/go/pkg/mod` for faster builds
- Pin the Go version to match `go.mod`
- Run race detection only in CI (it slows tests 2-10x)

---

### 5. Explain cross-compilation in Go. When does it break?

**Answer:**
Go supports cross-compilation natively by setting `GOOS` and `GOARCH`:

```bash
GOOS=linux GOARCH=arm64 go build -o app-arm64 .
```

It breaks when:
- **CGo is used:** Any package that imports `"C"` requires a C cross-compiler for the target platform. Setting `CGO_ENABLED=0` bypasses this but disables C code.
- **Platform-specific syscalls:** Code using `//go:build linux` will not compile for `GOOS=windows`.
- **Native libraries:** If a dependency wraps a C library (e.g., `go-sqlite3`), cross-compilation requires the C library built for the target.

---

### 6. What is the difference between `go mod vendor` and `go mod download`?

**Answer:**
- `go mod download` fetches all modules listed in `go.mod` and stores them in the module cache (`$GOMODCACHE`). They are shared across all projects.
- `go mod vendor` copies all dependencies into a `vendor/` directory inside the project. The project becomes self-contained — builds work without network access.

Use vendoring for: air-gapped environments, compliance audits, and protection against upstream repo deletion. Use the module cache for: normal development (avoids duplicating data).

Build with vendor: `go build -mod=vendor ./...`

---

### 7. How do build tags work and when should you use them?

**Answer:**
Build tags (build constraints) control which files are included during compilation:

```go
//go:build integration
```

Common uses:
- **Platform-specific code:** `//go:build linux` or `//go:build windows`
- **Integration tests:** `//go:build integration` (excluded by default)
- **Feature flags:** `//go:build premium`

Activate with: `go build -tags=integration ./...`

Since Go 1.17, use `//go:build` syntax (boolean expressions) instead of the old `// +build` comment.

---

### 8. How do you manage multiple Go versions on one machine?

**Answer:**
Three approaches:
1. **Official Go wrappers:** `go install golang.org/dl/go1.22.0@latest && go1.22.0 download`
2. **goenv:** `goenv install 1.23.0 && goenv local 1.23.0` (per-directory version)
3. **GOTOOLCHAIN directive:** In Go 1.21+, `go.mod` can specify `toolchain go1.23.0`, and Go auto-downloads it if `GOTOOLCHAIN=auto`

The `GOTOOLCHAIN` approach is the most modern and requires no extra tools.

---

### 9. What is GOPRIVATE and when is it needed?

**Answer:**
`GOPRIVATE` tells Go which modules should NOT be fetched via the public proxy (`proxy.golang.org`) and should NOT be verified against the public checksum database (`sum.golang.org`).

```bash
go env -w GOPRIVATE="github.com/company/*,gitlab.internal.com/*"
```

It is needed when your project depends on private repositories that are not accessible from the public internet. Without it, `go mod tidy` fails with 404 errors when trying to fetch private modules through the public proxy.

---

## Senior Level

### 7. How would you design a build infrastructure for 50+ Go microservices?

**Answer:**
Architecture components:
1. **Private module proxy (Athens/Artifactory)** — caches all dependencies, provides build resilience, handles private module authentication
2. **Shared build templates** — GitHub reusable workflows or similar, ensuring consistent CI across all services
3. **Go version management** — single `.go-version` file strategy with `GOTOOLCHAIN` directive in `go.mod`
4. **Dependency governance** — automated tool that checks PRs for blocked dependencies, license compliance
5. **Build tool (Mage or custom)** — Go-based build orchestration for type-safe, testable build scripts
6. **Multi-stage Dockerfiles** — shared base Dockerfile template with distroless runtime
7. **SBOM generation** — Software Bill of Materials for compliance

Key decisions:
- Monorepo vs multi-repo: monorepo with `go.work` if services share code; multi-repo with private proxy if they are independent
- Build caching: use CI cache for module cache and build cache; consider remote build cache for larger teams

---

### 8. Explain reproducible builds in Go. How do you verify them?

**Answer:**
A reproducible build means the same source code produces the same binary, byte-for-byte, regardless of where or when it is built.

Requirements:
1. `-trimpath` — removes local filesystem paths
2. Pinned Go version — via `toolchain` directive
3. `-ldflags="-buildid="` — removes non-deterministic build ID
4. No timestamps — avoid embedding `time.Now()` at build time
5. Pinned dependencies — `go.sum` with verified checksums

Verification:
```bash
# Build on machine A
go build -trimpath -ldflags="-s -w -buildid=" -o binary-a ./cmd/server
sha256sum binary-a

# Build on machine B (same source, same Go version)
go build -trimpath -ldflags="-s -w -buildid=" -o binary-b ./cmd/server
sha256sum binary-b

# Hashes should match
```

Note: CGo breaks reproducibility because it depends on the C compiler version and system headers.

---

### 9. How does the Go module proxy work internally?

**Answer:**
The Go module proxy (`proxy.golang.org`) implements a simple REST API:

```
GET /<module>/@v/list        -> list of versions
GET /<module>/@v/<ver>.info  -> {"Version":"v1.0.0","Time":"2024-01-01T00:00:00Z"}
GET /<module>/@v/<ver>.mod   -> go.mod file content
GET /<module>/@v/<ver>.zip   -> source code archive
GET /<module>/@latest        -> latest version info
```

Resolution flow:
1. Go tool reads `GOPROXY` (default: `https://proxy.golang.org,direct`)
2. Tries each proxy in order; if 404/410, tries next
3. For public modules, verifies checksum against `sum.golang.org`
4. Stores module in `GOMODCACHE` as read-only directory

The proxy caches modules permanently — even if the source repo is deleted, cached modules remain available.

---

### 10. What are the security implications of the Go build process?

**Answer:**
Attack vectors:
1. **Supply chain attacks** — compromised dependency injects malicious code. Mitigated by `go.sum` verification and `sum.golang.org`.
2. **Typosquatting** — attacker publishes a module with a similar name. Mitigated by dependency review in PRs.
3. **Build environment compromise** — if CI is compromised, built binaries are untrusted. Mitigated by reproducible builds and binary signing.
4. **Information leakage** — without `-trimpath`, binaries contain developer usernames and directory paths.
5. **Phantom dependencies** — `replace` directives can point builds to arbitrary code.

Mitigations:
- `go mod verify` in CI
- `govulncheck` in CI
- SBOM generation for compliance
- Binary signing with `cosign`
- Dependency allow-lists

---

### 11. How does the GOTOOLCHAIN directive work and when would you use it?

**Answer:**
Introduced in Go 1.21, `GOTOOLCHAIN` controls which Go toolchain is used:

```go
// go.mod
go 1.23.0          // minimum required version
toolchain go1.23.4 // preferred toolchain version
```

Modes:
- `GOTOOLCHAIN=auto` (default): download required toolchain if local is too old
- `GOTOOLCHAIN=local`: use only local installation, fail if too old
- `GOTOOLCHAIN=go1.23.0`: force specific version

Use cases:
- Ensuring all developers and CI use exactly the same Go version
- Gradual Go version upgrades (update `toolchain` first, then `go` directive)
- Preventing accidental use of newer Go features

---

### 12. Explain vendoring vs module proxy. When to use each?

**Answer:**

| Aspect | Vendoring | Module Proxy |
|--------|-----------|-------------|
| Storage | In repository | External server |
| Network | Not needed at build time | Required at build time |
| Repo size | Large (includes all dep source) | Small |
| Update workflow | `go mod vendor` | Automatic on `go mod tidy` |
| Audit | Full source visible in repo | Must check cache/proxy |

Use vendoring when:
- Building in air-gapped environments
- Compliance requires full source audit
- Protecting against upstream deletion
- Docker builds need deterministic layer caching

Use module proxy when:
- Normal development workflow
- Team has reliable network
- Many projects share dependencies (cache saves disk)
- Rapid dependency updates are needed

Many organizations use both: module proxy for development, vendoring for release builds.

---

## Scenario-Based Questions

### 10. Your Go builds work locally but fail in CI with "module not found" errors. How do you debug this?

**Answer:**
Step-by-step approach:
1. **Check Go versions:** Compare `go version` locally vs CI. Version mismatch can cause different module resolution.
2. **Check `go.sum`:** Run `go mod tidy` locally and verify `go.sum` is committed. Uncommitted go.sum is the #1 cause.
3. **Check private modules:** If the failing module is private, verify `GOPRIVATE` is set in CI and authentication (git tokens) is configured.
4. **Check proxy configuration:** Compare `go env GOPROXY` in both environments. CI might have a different proxy or no proxy.
5. **Check network:** CI runners may have restricted outbound network access. Verify the module proxy is reachable.
6. **Reproduce in Docker:** Build a Docker container matching CI and try to build there.

```bash
# Quick diagnostic commands:
go env GOPROXY GOPRIVATE GONOSUMDB
go mod tidy -v           # verbose output shows what it's doing
go mod why -m <module>   # why is this module needed?
```

---

### 11. A new team member reports that `go test -race ./...` passes locally but produces race conditions in CI. What could cause this?

**Answer:**
Step-by-step approach:
1. **Non-deterministic test order:** Go runs test functions in definition order within a package, but packages run in parallel. CI may have different parallelism.
2. **Environment differences:** Different CPU count, timing, network latency can expose races that are hidden locally.
3. **Test isolation:** Tests may share global state. In CI with higher parallelism, this becomes visible.
4. **File system differences:** Tests writing to temp directories may conflict on CI.

Fix: Always run `go test -race -count=3 ./...` to catch flaky races. Use `t.Parallel()` explicitly and avoid global state in tests.

---

### 12. Your Docker image builds take 10 minutes because dependencies are re-downloaded every time. How do you fix this?

**Answer:**
The problem is that `COPY . .` invalidates the Docker layer cache when ANY file changes, including source code, which triggers a full `go mod download`.

Fix with layer-separated Dockerfile:
```dockerfile
FROM golang:1.23 AS builder
WORKDIR /app

# Layer 1: Dependencies only (cached unless go.mod/go.sum change)
COPY go.mod go.sum ./
RUN go mod download && go mod verify

# Layer 2: Source code (only this layer rebuilds on code changes)
COPY . .
RUN CGO_ENABLED=0 go build -o /server ./cmd/server
```

Additional optimizations:
- Use Docker BuildKit with `--mount=type=cache,target=/go/pkg/mod` for even faster builds
- Consider using `actions/cache` in CI to cache the Go module directory
- Pre-build a base image with common dependencies

---

### 13. You need to upgrade Go from 1.21 to 1.23 across 20 services. What is your upgrade plan?

**Answer:**
1. **Read release notes:** Check Go 1.22 and 1.23 release notes for breaking changes
2. **Update one service first:** Change `go.mod` to `go 1.23` and `toolchain go1.23.0`, run full test suite
3. **Check compatibility:** Run `go vet ./...` and `staticcheck` — they catch deprecated API usage
4. **Update CI:** Change Go version in CI configuration
5. **Test with race detector:** `go test -race ./...` — new Go versions often find new races
6. **Automate:** Use a script or renovatebot to create PRs for all 20 services
7. **Roll out gradually:** Deploy updated services one at a time, monitor for issues
8. **Update tooling:** Ensure `golangci-lint`, `govulncheck`, and other tools are compatible

---

### 14. Your team is starting a new project. Should you use `go.work` workspaces?

**Answer:**
Use `go.work` if:
- You are developing multiple Go modules simultaneously (e.g., a service and a shared library)
- Changes to the library need to be tested in the service before publishing

Do NOT use `go.work` if:
- Each service is independently developed
- Modules are versioned and published via tags

Key rules:
- NEVER commit `go.work` to the repository (add to `.gitignore`)
- Use `go.work` only for local development
- CI should build each module independently

```bash
# Local development setup
go work init ./service ./shared-lib
# This lets you edit shared-lib and immediately test in service
```

---

## FAQ

### Q: What do interviewers actually look for in Go environment answers?

**A:** Key evaluation criteria:
- **Junior:** Can install Go, create a module, run code. Knows the difference between GOPATH and modules.
- **Middle:** Can set up CI/CD, cross-compile, use Docker for Go, configure private modules. Understands build tags and testing workflows.
- **Senior:** Can design build infrastructure for teams, explain module proxy internals, implement reproducible builds, make architecture decisions about vendoring vs proxies, and articulate security implications.

### Q: How important is knowing build flags for interviews?

**A:** Very important for senior roles. Knowing `-trimpath`, `-ldflags`, `CGO_ENABLED`, and `-race` shows production experience. For junior/middle roles, knowing `go build`, `go test`, and `go mod tidy` is sufficient.

### Q: Should I know Go internals (compiler, linker) for interviews?

**A:** Only for principal/staff-level positions. Most interviews focus on practical skills: setting up projects, CI/CD, Docker, and dependency management. Knowing how the build cache works or how `-X` embeds variables is a strong differentiator but not usually required.

### Q: What is the most common Go environment mistake candidates make in interviews?

**A:** Not knowing the difference between `go mod tidy` and `go get`, or not understanding why `go.sum` should be committed. Another common mistake is not knowing that `CGO_ENABLED=0` is needed for scratch/distroless Docker images.
