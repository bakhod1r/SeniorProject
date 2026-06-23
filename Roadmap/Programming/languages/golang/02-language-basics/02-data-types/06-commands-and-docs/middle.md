# Go Commands & Documentation — Middle Level

## Focus: Why and When to Use Each Tool

---

## 1. Introduction

At the middle level, Go commands become part of your development workflow and team infrastructure. This level covers why each tool exists, when to use which flag, how to integrate commands into CI/CD pipelines, and the deeper philosophy behind Go's approach to documentation and tooling.

---

## 2. Prerequisites

- Familiarity with all basic `go` commands
- Understanding of Go modules (`go.mod`, `go.sum`)
- Experience with a CI system (GitHub Actions, Jenkins, etc.)
- Understanding of Go interfaces and type system

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Static analysis** | Analyzing code without executing it |
| **Linter** | A tool that checks code for style and potential bugs |
| **go.mod** | Module definition file specifying module path and dependencies |
| **go.sum** | Cryptographic checksums for all dependencies |
| **Module proxy** | A server that caches Go modules (GOPROXY setting) |
| **Checksum database** | sum.golang.org — verifies module integrity (GONOSUMCHECK) |
| **go:generate directive** | A comment that triggers code generation when `go generate` runs |
| **build tag** | A conditional compilation mechanism (`//go:build linux`) |
| **vendor directory** | A local copy of dependencies for offline builds |
| **GOFLAGS** | Default flags applied to all go commands |

---

## 4. Core Concepts (Why and When)

### 4.1 Why `go doc` Instead of Just Reading GitHub?

```bash
# 1. Works offline — no internet needed
go doc fmt.Println

# 2. Shows YOUR version's API (not current main branch)
go doc github.com/some/library.Function

# 3. Faster than browser navigation
go doc strings  # instant, vs opening browser, navigating, searching

# 4. Shows source code for any package
go doc -src net/http.Request

# 5. Works for private packages (no pkg.go.dev needed)
go doc ./internal/auth
```

### 4.2 Why `go fmt` Is Non-Negotiable

The Go team made a deliberate decision: there is exactly ONE correct style. This eliminates:
- Debates about tabs vs spaces (tabs win — it's in the spec)
- PR review comments about formatting
- Merge conflicts caused purely by formatting differences
- Cognitive load of reading code in multiple styles

```bash
# Configure git to ignore whitespace in diffs
git config --global core.whitespace trailing-space,space-before-tab

# Run before every commit (can be automated via pre-commit hook)
go fmt ./...

# OR: Use gofmt directly for more control
gofmt -w .              # Format all .go files
gofmt -d .              # Show what would change
gofmt -e .              # Show all errors, even when many
gofmt -r 'a[b:len(a)] -> a[b:]' .  # Apply rewrite rules!
```

### 4.3 When to Use `go vet` vs Linters

```
go vet:
- Built-in, maintained by Go team
- Very fast
- High signal-to-noise: catches real bugs
- Part of the official Go toolchain

staticcheck:
- Superset of go vet
- Finds more bugs and anti-patterns
- Some false positives

golangci-lint:
- Meta-linter: runs many linters at once
- Configurable (.golangci.yml)
- The industry standard for CI
- Includes: go vet, staticcheck, errcheck, gosec, and 50+ more
```

**Recommendation:** Use `go vet` in pre-commit hooks (fast), `golangci-lint` in CI (comprehensive).

### 4.4 Why `go generate` Is Powerful

```go
// In your source code, add directives:
//go:generate stringer -type=Direction
//go:generate mockgen -source=service.go -destination=mock_service.go
//go:generate protoc --go_out=. *.proto

// Then run to execute all generators:
// go generate ./...
```

`go generate` is not run automatically — it's only run when you explicitly invoke it, then you commit the generated files. This ensures reproducible builds.

---

## 5. Evolution and Historical Context

### Timeline

- **Go 1.0 (2012):** `go build`, `go run`, `go test`, `go fmt`, `go doc` (basic)
- **Go 1.4 (2014):** `go generate` introduced
- **Go 1.5 (2015):** `go doc` rewritten (current version by Rob Pike)
- **Go 1.11 (2018):** Modules introduced (`go mod init`, `go mod tidy`)
- **Go 1.13 (2019):** Module proxy and checksum database enabled by default
- **Go 1.14 (2020):** `go mod vendor` improved
- **Go 1.16 (2021):** `go install` for installing tools outside of modules
- **Go 1.17 (2021):** `go mod graph` pruning, lazy loading
- **Go 1.21 (2023):** `go get` can no longer install tools (use `go install`)

### Why Documentation Changed

The original `godoc` served web pages. `go doc` was added as a faster, terminal-native alternative. The goal was always: documentation should be as easy to access as code.

---

## 6. Alternative Approaches

### Alternative 1: Documentation Methods

```bash
# Method A: Terminal (fastest)
go doc fmt.Println

# Method B: Local web server (prettiest for extended reading)
go install golang.org/x/tools/cmd/godoc@latest
godoc -http=:6060
# Visit http://localhost:6060

# Method C: pkg.go.dev (shareable, always online)
# https://pkg.go.dev/fmt#Println

# Method D: Editor integration
# Most Go editors (VS Code + gopls, GoLand) show docs on hover
# This uses the same data as `go doc` internally
```

### Alternative 2: Static Analysis Tools

```bash
# Built-in:
go vet ./...

# Community tools (install separately):
go install honnef.co/go/tools/cmd/staticcheck@latest
staticcheck ./...

go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest
golangci-lint run

# Security-focused:
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...
```

---

## 7. Anti-Patterns

### Anti-Pattern 1: Skipping `go fmt`

```bash
# WRONG — pushing unformatted code
git add .
git commit -m "fix bug"
git push

# RIGHT — always format before commit
go fmt ./...
go vet ./...
git add .
git commit -m "fix bug"
git push
```

### Anti-Pattern 2: Undocumented Public APIs

```go
// BAD — exported function with no docs
func ProcessData(data []byte) error {
    // ...
}

// GOOD — properly documented
// ProcessData validates and stores the given data in the internal buffer.
// It returns ErrInvalidData if the data fails validation.
// It returns ErrBufferFull if the buffer is at capacity.
func ProcessData(data []byte) error {
    // ...
}
```

### Anti-Pattern 3: Using `go:build ignore` to Hide Broken Code

```go
//go:build ignore
// +build ignore

// This file contains broken/temporary code
package main
// ...
```

Better: fix the broken code, or delete it. Build tags should be used for platform-specific code, not to hide things.

### Anti-Pattern 4: Running `go generate` in Build Scripts

```bash
# WRONG — generates code during every build
build:
    go generate ./...
    go build ./...

# BETTER — generate is a development step, not build step
generate:
    go generate ./...

build:
    go build ./...
```

Generated files should be committed. Running generate should be a developer action, not a CI build action.

---

## 8. Debugging Guide

### Problem 1: `go vet` Reports False Positive

```bash
# Disable specific analyzer with nolint comment
// nolint: govet  # this is a go vet check, not golangci-lint

# For go vet specifically:
go vet -composites=false ./...  # disable composite literal check

# Check which analyzers exist
go doc cmd/vet
```

### Problem 2: `go doc` Shows Wrong Version

```bash
# Check which module version is active
go list -m github.com/some/package

# To see docs for a specific version:
# The docs will reflect the version in go.mod
# Update go.mod to see different version's docs:
go get github.com/some/package@v1.2.3
go doc github.com/some/package.Function
```

### Problem 3: `gofmt` Changes Are Unexpected

```bash
# Preview changes without applying
gofmt -d ./myfile.go

# See what rule triggered a change:
# The most common: trailing commas in multi-line function calls/declarations
# go fmt REQUIRES trailing commas before closing ) or }
```

### Problem 4: `go env` Values Are Unexpected

```bash
# See where each value comes from
go env -json

# Check user-level overrides
cat $GOENV  # usually ~/.config/go/env

# Reset all user-level settings
go env -u GOPATH
go env -u GOPROXY
```

---

## 9. Comparison with Other Languages

### Go vs Node.js (npm)

```
Go:
  go doc net/http        # immediate, built-in
  go fmt ./...           # immediate, built-in
  go vet ./...           # immediate, built-in

Node.js:
  # need to visit npmjs.com or read README.md
  npx prettier --write . # need to install prettier
  npx eslint .           # need to install + configure eslint
```

Go's approach: tooling is standardized and included. Node's approach: choose your own tools from the ecosystem.

### Go vs Python

```
Go:
  go doc os.path          # no installation needed
  go fmt ./...            # enforced standard style

Python:
  pydoc os.path           # built-in, but less used
  black src/              # need to install black
  flake8 src/             # need to install flake8
```

### Go vs Java

```
Go:
  go doc net/http.Client  # terminal-native
  go build ./...          # single command

Java:
  javadoc -d docs src/    # generates HTML from Javadoc comments
  mvn javadoc:javadoc     # Maven plugin approach
  # No standard formatting tool — need checkstyle, google-java-format
```

---

## 10. Real-World Analogies (Advanced)

**`go generate` is a build recipe book:**
A restaurant (project) has recipes (generators). The recipe book (`go:generate` directives) records what to cook (generate) and how. The chef (`go generate`) follows the recipes to prepare the dishes (generated code). The dishes are prepared once and ready to serve — they're not cooked on every customer order (build).

**The CI pipeline as an assembly line:**
`go fmt` → `go vet` → `go build` → `go test` is an assembly line. Each stage checks a different quality aspect before advancing. A failure at any stage stops the line.

---

## 11. Mental Models (Advanced)

**Documentation as a First-Class Concern:**
In Go, documentation is not an afterthought — it's part of the code review. `go doc` and pkg.go.dev are the primary ways users discover your API. If your function doesn't have a doc comment, it's as if it doesn't exist to new users.

**The Funnel of Code Quality:**
```
go fmt      → catches all formatting issues        (100% of issues)
go vet      → catches ~20% of common bugs          (~20% of issues)
staticcheck → catches ~50% of common bugs          (~50% of issues)
golangci-lint → catches ~70% of common bugs        (~70% of issues)
go test     → catches remaining logic bugs         (goal: 80-90%)
```

---

## 12. Pros and Cons (Advanced Analysis)

### Pros of Go's Toolchain Philosophy
- **Reproducibility:** `go build` is deterministic — same inputs, same output
- **No configuration:** `go fmt` has no config file — enforces one style universally
- **Discovery:** `go list ./...` helps new team members understand project structure
- **Offline-friendly:** All tools work without internet access

### Cons
- **Limited customization:** Can't configure `go fmt` to use your preferred style
- **`go vet` is conservative:** Misses many real bugs that third-party linters catch
- **No autofix:** `go vet` reports but doesn't fix; only `go fmt` auto-fixes

---

## 13. `go doc` — Deep Dive

### Flag Reference

```bash
go doc [flags] [package | [package.]symbol[.methodOrField]]

Flags:
  -all       Show documentation for all symbols, not just exported
  -c         Case-sensitive matching
  -cmd       Show documentation for package's main command
  -short     One-line representation for each symbol
  -src       Show the full source code for the symbol
  -u         Show unexported symbols along with exported (like -all but wider)

# Examples:
go doc -all -u fmt          # everything in fmt, including unexported
go doc -short os            # one-line summary per exported symbol
go doc -c bufio.Reader      # case-sensitive match
go doc -src http.ServeMux   # show source code of ServeMux
```

### pkg.go.dev vs `go doc` Differences

| Feature | `go doc` | pkg.go.dev |
|---------|----------|-----------|
| Speed | Instant | Requires network |
| Version | Your local module version | Any published version |
| Private packages | Yes | No (unless using GOPROXY) |
| Examples | Text only | Runnable in browser |
| Search | No search engine | Full-text search |
| Badges (Go Report Card, etc.) | No | Yes |
| Source links | No | Links to GitHub |

---

## 14. `go env` — Complete Reference

```bash
# Key variables and their meanings:
GOROOT    # Go installation directory
GOPATH    # Workspace for non-module projects (less relevant today)
GOMODCACHE # Where downloaded modules are cached (~/.go/pkg/mod)
GOBIN     # Where `go install` puts binaries (default: $GOPATH/bin)
GOCACHE   # Build cache (~/.cache/go-build)
GOENV     # Location of user-level env file (~/.config/go/env)
GOPROXY   # Module proxy URL (default: https://proxy.golang.org,direct)
GONOSUMCHECK # Patterns to skip sum database check
GONOSUMDB # Modules to skip sum database check
GOFLAGS   # Default flags for all go commands
GOOS      # Target OS: linux, windows, darwin, freebsd
GOARCH    # Target arch: amd64, arm64, 386, arm
CGO_ENABLED # Whether to enable cgo (default: 1)
GOEXPERIMENT # Experimental features to enable

# Setting for corporate environments:
GOPROXY=https://proxy.company.com,direct  # use corporate proxy
GONOSUMCHECK=*.company.com                # skip checksum for internal packages
```

---

## 15. Code Examples (Intermediate)

### Example 1: Comprehensive Doc Comment with Examples and Deprecation

```go
// Package ratelimit implements token-bucket rate limiting.
//
// Basic usage:
//
//	limiter := ratelimit.New(100) // 100 requests per second
//	for {
//	    limiter.Take() // blocks until a token is available
//	    handleRequest()
//	}
package ratelimit

// Limiter is a token-bucket rate limiter.
// A Limiter is safe for concurrent use by multiple goroutines.
type Limiter struct {
    rate float64
    // unexported fields...
}

// New creates a new Limiter that allows the given number of events per second.
//
// For best results, start the limiter before it's needed:
//
//	limiter := ratelimit.New(100)
//	// ... set up other things ...
//	for _, req := range requests {
//	    limiter.Take()
//	    process(req)
//	}
func New(rate int) *Limiter {
    return &Limiter{rate: float64(rate)}
}

// Take blocks until a token is available, then consumes it.
// Take is safe for concurrent use.
func (l *Limiter) Take() {
    // ...
}

// TakeWithContext is like Take but respects context cancellation.
//
// Deprecated: Use TakeContext instead, which returns an error
// when the context is cancelled.
func (l *Limiter) TakeWithContext(ctx interface{}) {
    // old implementation
}

// TakeContext blocks until a token is available or ctx is done.
// It returns ctx.Err() if the context was cancelled.
func (l *Limiter) TakeContext(ctx interface{}) error {
    // new implementation
    return nil
}
```

### Example 2: go:generate with Multiple Generators

```go
package main

// Generate mock for testing
//go:generate mockgen -source=./service.go -destination=./mock/service_mock.go -package=mock

// Generate string representations for enums
//go:generate stringer -type=Status,Priority

// Generate protobuf code
//go:generate protoc --go_out=. --go-grpc_out=. api.proto

// Generate embedded file system
//go:generate go-bindata -o=assets.go -pkg=main ./static/...

type Status int

const (
    StatusPending Status = iota
    StatusActive
    StatusDone
)

type Priority int

const (
    PriorityLow Priority = iota
    PriorityMedium
    PriorityHigh
)
```

Running `go generate ./...` executes all these generators in order.

### Example 3: CI Pipeline Integration

```yaml
# .github/workflows/ci.yml
name: CI

on: [push, pull_request]

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-go@v4
        with:
          go-version: '1.21'

      - name: Format check
        run: |
          if [ "$(gofmt -l .)" != "" ]; then
            echo "Unformatted files:"
            gofmt -l .
            exit 1
          fi

      - name: Vet
        run: go vet ./...

      - name: Build
        run: go build ./...

      - name: Test
        run: go test -race -coverprofile=coverage.txt ./...

      - name: Lint (golangci-lint)
        uses: golangci/golangci-lint-action@v3
        with:
          version: v1.55
```

### Example 4: go list for Dependency Auditing

```bash
# Find all direct and indirect dependencies
go list -m all

# Find which modules have known vulnerabilities
govulncheck ./...

# Find the dependency graph for a specific package
go list -json -deps . | jq -r '.Deps[]' | sort | head -20

# Find why a dependency is included
go mod why github.com/some/package

# Show module graph
go mod graph | grep gin  # find all gin-related deps
```

---

## 16. Error Handling (Intermediate)

```bash
# go vet error: Printf format issue
go vet ./...
# ./main.go:15:3: Printf call has arguments but no formatting directives
# Fix: use fmt.Print(x) not fmt.Printf(x) for non-format strings

# go vet error: unreachable code
# ./main.go:20:3: unreachable code
# Fix: remove code after return/panic

# go build error: ambiguous import
# Found in two different modules:
# Likely need to use replace directive in go.mod

# go list error: module not found
go list -m github.com/nonexistent/pkg
# go: module github.com/nonexistent/pkg: not a known module path
# Fix: check the import path spelling
```

---

## 17. Security Considerations (Intermediate)

```bash
# Check for known vulnerabilities in dependencies
go install golang.org/x/vuln/cmd/govulncheck@latest
govulncheck ./...

# Audit GOPROXY setting — ensure you're using trusted proxy
go env GOPROXY
# Default: https://proxy.golang.org,direct (trusted)

# For private code, use GONOSUMCHECK to skip public checksum DB
go env -w GONOSUMCHECK="*.internal.company.com"

# Verify your go.sum is complete (not tampered)
go mod verify

# Check for dependencies with unusual licenses
go list -json -m all | jq -r '.[] | select(.Indirect == false) | .Path'
```

---

## 18. Performance Tips (Intermediate)

```bash
# Speed up builds with build cache
go env GOCACHE              # where cache lives
go clean -cache             # clear if debugging build issues

# Build cache is automatic — don't disable it
# The cache makes repeated builds nearly instant for unchanged packages

# Parallel test execution
go test -parallel=8 ./...   # run up to 8 test binaries in parallel

# Profile the build itself
go build -x ./...           # verbose: shows all commands run
go build -work ./...        # keeps temp directory for inspection

# List what would be compiled without compiling
go list -f '{{.ImportPath}} {{.Dir}}' ./...
```

---

## 19. Best Practices (Intermediate)

1. **Automate formatting:** Configure your editor to run `go fmt` on save
2. **Use `golangci-lint` in CI:** It's more comprehensive than `go vet` alone
3. **Document all exported symbols:** No exceptions — even "obvious" functions need docs
4. **Use `go mod tidy` regularly:** Removes unused dependencies from `go.mod`
5. **Commit generated files:** Generated code should be checked in (reproducibility)
6. **Use `go doc` for API design:** If you can't write a good doc comment, your API is unclear
7. **Run `go mod verify` in CI:** Ensures `go.sum` matches downloaded modules

---

## 20. Edge Cases and Pitfalls (Intermediate)

```bash
# Pitfall 1: go fmt can't format code with syntax errors
# Fix syntax errors before formatting

# Pitfall 2: go generate order matters
# Generators are run in the order they appear in the source file
# If generator B depends on output of generator A, they must be in order

# Pitfall 3: go list -m all includes INDIRECT dependencies
# The (indirect) annotation indicates it's not directly imported
# go mod tidy will remove truly unused indirect dependencies

# Pitfall 4: GOFLAGS can cause surprising behavior
go env GOFLAGS  # if this is set, it modifies all go commands
# -mod=vendor means `go build` will use vendor/ not module cache
```

---

## 21. Common Mistakes (Intermediate)

```bash
# Mistake 1: Not running go mod tidy before committing
# Results in go.mod having unused dependencies

# Mistake 2: go install inside a module changes go.mod
# Use: go install tool@version  (Go 1.16+)
# Not: go get tool  (modifies go.mod)

# Mistake 3: Documenting "what" not "why"
# BAD:
# // SetTimeout sets the timeout
// SetTimeout(d time.Duration)

# GOOD:
// SetTimeout sets the deadline for all operations on this connection.
// The timeout applies to reads, writes, and dial operations.
// A value of zero disables the timeout.
// SetTimeout(d time.Duration)

# Mistake 4: Using go vet as the only quality check
# go vet is fast but limited
# Add golangci-lint for comprehensive checking
```

---

## 22. Common Misconceptions (Intermediate)

**Misconception: "doc comments are just comments"**
Reality: Doc comments are parsed by `go doc`, `godoc`, `gopls` (IDE), and pkg.go.dev. They follow specific formatting rules (first line starts with symbol name, blank line = paragraph, indented = code block). They are part of the public API.

**Misconception: "`go generate` runs automatically during build"**
Reality: `go generate` NEVER runs automatically. You must explicitly run `go generate ./...`. Generated files are committed and used directly by the build.

---

## 23. Tricky Points (Intermediate)

```bash
# Trick 1: go doc can show a method's receiver type
go doc (*http.Request).Context  # shows the method on the pointer receiver

# Trick 2: go list can filter with templates
go list -f '{{if not .Standard}}{{.ImportPath}}{{end}}' ./...
# Only non-standard library packages

# Trick 3: go env -json for programmatic use
go env -json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['GOROOT'])"

# Trick 4: go vet respects build tags
go vet -tags integration ./...  # only vet files with //go:build integration tag
```

---

## 24. Test (Quiz)

**Q1.** What does `gofmt -r 'a[b:len(a)] -> a[b:]' .` do?
a) Reformats all files
b) Replaces slice expressions with the simplified form
c) Shows the repository diff
d) This flag doesn't exist

**Answer:** b) It applies the rewrite rule across all files — replaces `a[b:len(a)]` with `a[b:]`

**Q2.** When should you commit generated files?
a) Never — generate fresh on each build
b) Always — generated files should be in version control
c) Only in release branches
d) Only for protobuf files

**Answer:** b) Always — ensures reproducible builds without requiring generators on every machine

**Q3.** What does `go mod why github.com/gin-gonic/gin` show?
a) The version of gin in use
b) The chain of imports that cause gin to be a dependency
c) Why gin was removed from go.mod
d) The license for gin

**Answer:** b) Shows the import chain that requires gin

---

## 25. Self-Assessment Checklist

- [ ] I configure my editor to run `go fmt` on save
- [ ] I use `golangci-lint` in my CI pipeline
- [ ] I write complete doc comments for all exported APIs
- [ ] I understand when and why to use `go generate`
- [ ] I know all key `go env` variables and their meanings
- [ ] I use `go mod tidy` before committing dependency changes
- [ ] I understand pkg.go.dev vs local `go doc`
- [ ] I can debug `go vet` issues and distinguish false positives
- [ ] I know when to use `go get` vs `go install`

---

## 26. Summary

At the middle level, Go commands become part of team culture and CI infrastructure. The key insights are:
- **Documentation is an API surface** — treat doc comments with the same care as code
- **Tooling is opinionated by design** — `go fmt` has no configuration, and that's a feature
- **`go generate` is explicit** — generated code is committed, never generated at build time
- **`go vet` is the floor, not the ceiling** — use golangci-lint for comprehensive checking
- **Module management is automated** — `go mod tidy`, `go mod verify` keep everything clean

---

## 27. Further Reading

- [Go blog: Writing good documentation](https://go.dev/blog/godoc)
- [Go spec: Doc comments](https://go.dev/doc/comment)
- [golangci-lint docs](https://golangci-lint.run/)
- [govulncheck docs](https://pkg.go.dev/golang.org/x/vuln)
- [Go modules reference](https://go.dev/ref/mod)
