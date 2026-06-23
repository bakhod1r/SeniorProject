# Go Command — Interview Questions

## Table of Contents

1. [Junior Level](#junior-level)
2. [Middle Level](#middle-level)
3. [Senior Level](#senior-level)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [FAQ](#faq)

---

## Junior Level

### 1. What is the difference between `go run` and `go build`?

**Answer:**
`go run` compiles the code into a temporary binary and immediately executes it. The binary is stored in a temp directory and deleted afterward. `go build` compiles the code and produces a permanent binary in the current directory (or the path specified by `-o`). Use `go run` for quick testing during development. Use `go build` when you need a deployable binary.

---

### 2. What does `go fmt` do and why is it important?

**Answer:**
`go fmt` automatically formats Go source code to follow the standard Go style (tabs for indentation, specific spacing rules). It is important because:
- It eliminates code style debates in teams
- Every Go project looks the same
- It is considered mandatory in the Go community
- Most CI pipelines reject unformatted code

```bash
go fmt ./...   # format all packages
```

---

### 3. What is `go mod init` and when do you use it?

**Answer:**
`go mod init` creates a new `go.mod` file, initializing the current directory as a Go module. You use it when starting a new Go project:

```bash
go mod init github.com/username/myproject
```

This creates a `go.mod` file that declares the module path and Go version. Every Go project needs a `go.mod` file to manage dependencies.

---

### 4. What is the difference between `go get` and `go install`?

**Answer:**
- `go get` adds or updates a dependency in `go.mod`. It modifies your project's dependency list.
- `go install` compiles a Go package and installs the resulting binary to `$GOPATH/bin`. It is used to install Go tools.

```bash
# Add a library dependency to your project
go get github.com/gin-gonic/gin

# Install a CLI tool globally
go install golang.org/x/tools/gopls@latest
```

Since Go 1.17, `go get` should NOT be used to install binaries — use `go install` instead.

---

### 5. What does `go vet` do?

**Answer:**
`go vet` runs static analysis on Go code to find suspicious constructs that compile fine but are likely bugs. Examples include:
- Printf format string mismatches
- Unreachable code after a return
- Copying a mutex (which breaks synchronization)
- Incorrect struct tags

```bash
go vet ./...   # check all packages
```

---

### 6. What command removes unused dependencies from `go.mod`?

**Answer:**
`go mod tidy`. It both adds missing dependencies (that are imported but not in `go.mod`) and removes unused dependencies (that are in `go.mod` but not imported by any code).

```bash
go mod tidy
```

---

### 7. How do you run all tests in a Go project?

**Answer:**
```bash
go test ./...        # run all tests recursively
go test -v ./...     # verbose output showing each test
go test -run TestFoo # run only tests matching "TestFoo"
go test -count=1 ./... # force re-run (skip cache)
```

The `./...` pattern means "this directory and all subdirectories."

---

## Middle Level

### 4. How do you inject version information into a Go binary at build time?

**Answer:**
Use `-ldflags` with `-X` to set string variables at link time:

```go
package main

var version = "dev"

func main() {
    println("Version:", version)
}
```

```bash
go build -ldflags="-X main.version=1.2.3" -o server
./server
# Output: Version: 1.2.3
```

The variable must be a package-level `var` of type `string` (not a `const`). The full package path is required for non-main packages: `-X github.com/user/app/config.Version=1.2.3`.

---

### 5. What is the race detector and when should you use it?

**Answer:**
The race detector (`-race` flag) instruments memory accesses at compile time to detect data races during execution. A data race occurs when two goroutines access the same variable concurrently and at least one access is a write.

```bash
go test -race ./...    # always use in CI
go run -race main.go   # use during development
```

**When to use:** Always in CI tests. During development when debugging concurrency issues.
**When NOT to use:** In production builds. The race detector adds 5-10x overhead in CPU and 5-10x overhead in memory.

---

### 6. What is `go generate` and how does it differ from `go build`?

**Answer:**
`go generate` scans `.go` files for `//go:generate` comments and runs the specified shell commands. It is NOT part of the build process — it must be run manually.

```go
//go:generate mockgen -source=repo.go -destination=mock_repo.go
```

Key differences:
- `go build` never executes `//go:generate` directives
- `go generate` output (generated `.go` files) must be committed to version control
- `go generate` may require external tools to be installed
- It is a development-time operation, not a build-time operation

---

### 7. How do you create a fully static Go binary?

**Answer:**
```bash
CGO_ENABLED=0 go build -ldflags="-s -w" -trimpath -o server ./cmd/server
```

- `CGO_ENABLED=0`: Disables CGO, ensuring no dynamic C library linking
- `-ldflags="-s -w"`: Strips symbol table (`-s`) and DWARF debug info (`-w`), reducing size by ~30%
- `-trimpath`: Removes local file system paths from the binary

This produces a binary that can run in a `scratch` or `distroless` Docker container with zero dependencies.

---

### 8. What is `go mod vendor` and when should you use it?

**Answer:**
`go mod vendor` copies all dependencies into a `vendor/` directory within your project. When you build with `-mod=vendor`, Go uses these local copies instead of the module cache.

**Use cases:**
- Air-gapped environments without internet access
- Compliance requirements to audit all dependency code
- Ensuring builds are hermetic (same result regardless of proxy state)

**When NOT to use:** Most projects should rely on `GOPROXY` (default: `proxy.golang.org`) which provides caching and availability.

---

### 9. How do you use `go work` for multi-module development?

**Answer:**
`go work` creates a workspace that links multiple local modules together, allowing simultaneous development without publishing intermediate versions:

```bash
go work init ./api ./service ./shared
```

This creates a `go.work` file. Changes to `./shared` are immediately available in `./api` and `./service` without running `go get` or using `replace` directives.

**Important:** Never commit `go.work` — it is a local development tool. Each module must independently compile without the workspace.

---

## Senior Level

### 10. How does the Go build cache work internally?

**Answer:**
The Go build cache (`~/.cache/go-build`) is a content-addressed store. The cache key for each package is a hash of:
- Package import path
- Source file content hashes
- Dependency compilation output hashes
- Build flags (`-gcflags`, `-ldflags`, `-tags`, etc.)
- Go version
- `GOOS`, `GOARCH`, `CGO_ENABLED`

If the hash matches an existing cache entry, the compiled output is reused. This is why the second `go build` is near-instant — unchanged packages are not recompiled.

Test caching works similarly but also considers environment variables, file system state, and test binary hash. Use `-count=1` to bypass test caching.

---

### 11. How would you design a cross-compilation pipeline for a Go CLI tool?

**Answer:**
```bash
#!/bin/bash
TARGETS=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
)

VERSION=$(git describe --tags --always)
LDFLAGS="-s -w -X main.version=${VERSION}"

for target in "${TARGETS[@]}"; do
    GOOS="${target%/*}"
    GOARCH="${target#*/}"
    EXT=""
    [[ "$GOOS" == "windows" ]] && EXT=".exe"

    CGO_ENABLED=0 GOOS=$GOOS GOARCH=$GOARCH \
        go build -trimpath -ldflags="$LDFLAGS" \
        -o "dist/cli-${GOOS}-${GOARCH}${EXT}" ./cmd/cli &
done
wait
```

**Key design decisions:**
- `CGO_ENABLED=0` for all targets — avoids cross-compiler toolchains
- Parallel builds (background jobs + `wait`) — reduces total time
- `-trimpath` — prevents path leakage between machines
- `-ldflags="-s -w"` — smallest possible binaries
- Semver from git tags — automated versioning

For production, consider [GoReleaser](https://goreleaser.com/) which handles checksums, changelogs, and release uploads.

---

### 12. What are the trade-offs between build tags and runtime configuration?

**Answer:**

| Aspect | Build Tags | Runtime Config |
|--------|-----------|----------------|
| Performance | Zero cost — code not compiled | Small cost — branch at startup |
| Flexibility | Requires rebuild to change | Change via env var / flag |
| Testing | Need separate builds for each combo | One build, different configs |
| Binary size | Smaller — unused code excluded | Larger — all code included |
| Debugging | Harder — which build am I running? | Easier — one binary, check config |

**Recommendation:**
- Build tags: Security features, platform code, debug-only profiling endpoints
- Runtime config: Feature flags, environment-specific settings, customer configurations

---

### 13. How does `go build -gcflags="-m"` help with performance optimization?

**Answer:**
`-gcflags="-m"` shows escape analysis results — which variables are allocated on the heap vs stack.

```bash
go build -gcflags="-m" main.go
# main.go:10:6: moved to heap: result   <- heap allocation
# main.go:15:6: msg does not escape      <- stack allocation
```

Stack allocation is free (no GC pressure). Heap allocation requires garbage collection. By understanding escape analysis, you can:
- Avoid unnecessary pointer returns that force heap allocation
- Reduce GC pressure in hot paths
- Verify that `sync.Pool` objects stay on the heap as expected

Use `-gcflags="-m -m"` for even more detailed output, including inlining decisions.

---

### 14. What happens when you run `go build -race` at the compiler level?

**Answer:**
The race detector is implemented by instrumenting memory accesses at compile time. The compiler inserts calls to `runtime.racefuncenter`, `runtime.raceread`, `runtime.racewrite`, etc., before every memory access.

At runtime, these calls record every read and write with a timestamp and goroutine ID in a shadow memory region. When two goroutines access the same address with at least one write and no synchronization between them, the detector reports a data race with full stack traces.

The overhead comes from:
- Additional function calls on every memory access
- 5-10x more memory (shadow memory tracks every 8 bytes)
- Serialization overhead for recording accesses

This is why race-detected binaries should never run in production.

---

### 15. How do you handle CGO in a cross-compilation pipeline?

**Answer:**
CGO cross-compilation requires a C cross-compiler for each target platform:

```bash
# Linux arm64 from amd64
CGO_ENABLED=1 CC=aarch64-linux-gnu-gcc \
    GOOS=linux GOARCH=arm64 go build -o server

# macOS from Linux (extremely difficult)
# Requires osxcross toolchain
CGO_ENABLED=1 CC=o64-clang \
    GOOS=darwin GOARCH=amd64 go build -o server
```

**Best practices:**
1. Avoid CGO whenever possible — use pure Go alternatives (e.g., `modernc.org/sqlite` instead of `go-sqlite3`)
2. If CGO is required, build inside Docker containers matching the target platform
3. Use Docker's multi-platform build (`docker buildx`) with QEMU for non-native architectures
4. Consider pre-building C dependencies as static libraries

---

## Scenario-Based Questions

### 16. Your CI pipeline takes 15 minutes. 10 minutes is Go compilation. How do you optimize it?

**Answer:**
Step-by-step approach:

1. **Cache Go module downloads:** Save `~/go/pkg/mod` between CI runs
   ```yaml
   - uses: actions/cache@v4
     with:
       path: ~/go/pkg/mod
       key: go-mod-${{ hashFiles('**/go.sum') }}
   ```

2. **Cache build artifacts:** Save `~/.cache/go-build`
   ```yaml
   - uses: actions/cache@v4
     with:
       path: ~/.cache/go-build
       key: go-build-${{ hashFiles('**/*.go') }}
   ```

3. **Build only changed packages:** Use `go list` to detect changes
   ```bash
   CHANGED=$(go list -m -json ./... | jq -r '.Dir')
   go build $CHANGED
   ```

4. **Run tests in parallel:** `go test -parallel $(nproc) ./...`

5. **Separate unit and integration tests:**
   ```bash
   go test -short ./...  # fast unit tests (2 min)
   go test -tags integration ./... # slow tests (separate pipeline)
   ```

Expected improvement: 15 min -> 3-4 min.

---

### 17. You need to ship a Go binary that works on Amazon Linux, Ubuntu, Alpine, and scratch containers. How?

**Answer:**
Build a fully static binary:

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w -extldflags '-static'" \
    -o server ./cmd/server
```

Verify it is static:
```bash
file server
# server: ELF 64-bit LSB executable, x86-64, statically linked

ldd server
# not a dynamic executable
```

Use a minimal Dockerfile:
```dockerfile
FROM scratch
COPY server /server
COPY ca-certificates.crt /etc/ssl/certs/
ENTRYPOINT ["/server"]
```

Key considerations:
- `CGO_ENABLED=0` is critical — if CGO is enabled, the binary links against glibc, which differs between Alpine (musl) and Ubuntu (glibc)
- Include CA certificates if the binary makes HTTPS requests
- Include timezone data (`/usr/share/zoneinfo`) if the binary handles time zones

---

### 18. A developer reports that `go generate` produces different output on their machine vs CI. How do you debug this?

**Answer:**
Step-by-step approach:

1. **Check tool versions:** The code generator (e.g., `stringer`, `mockgen`) may be a different version
   ```bash
   go version -m $(which stringer)
   ```

2. **Pin generator versions:** Use `go install tool@version` in CI
   ```bash
   go install golang.org/x/tools/cmd/stringer@v0.17.0
   ```

3. **Check Go version:** Different Go versions may produce different output
   ```bash
   go version
   ```

4. **Add CI verification:** After `go generate`, check for diffs
   ```bash
   go generate ./...
   git diff --exit-code
   # If this fails, generated code was stale
   ```

5. **Add `//go:generate` comments to a `tools.go` file:**
   ```go
   //go:build tools
   package tools

   import _ "golang.org/x/tools/cmd/stringer"
   ```
   This pins the tool version in `go.mod`.

---

## FAQ

### Q: What do interviewers actually look for in Go answers about the go command?

**A:** Key evaluation criteria:

- **Junior level:** Can explain `go run` vs `go build` vs `go install`. Knows `go fmt`, `go vet`, `go test`. Understands `go.mod` and `go mod tidy`. Demonstrates they have actually used the tool.

- **Middle level:** Knows `-ldflags` for version injection. Understands `-race` and when to use it. Can explain `go generate` workflow. Familiar with `go mod vendor` vs module proxy. Can set up a CI pipeline with proper Go commands.

- **Senior level:** Understands build cache internals (content-addressed, hash-based). Can design cross-compilation pipelines. Knows CGO trade-offs and when to avoid it. Understands escape analysis (`-gcflags="-m"`). Can explain what `-trimpath`, `-s`, `-w` do at the binary level. Mentions `GOSSAFUNC`, SSA visualization, and compiler optimization passes.

### Q: What is the single most important `go` command to know for interviews?

**A:** `go test -race ./...` — it demonstrates understanding of Go's concurrency model, the race detector, testing best practices, and CI pipeline design. Mentioning this unprompted shows practical Go experience.

### Q: Should I mention Makefiles in Go interviews?

**A:** Yes, if the question involves production builds or CI/CD. Real Go projects almost always wrap `go build` in a Makefile or CI script with `-ldflags`, `-trimpath`, and build tags. Showing you understand the full build pipeline (not just `go build`) demonstrates production experience.
