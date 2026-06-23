# Go Commands & Documentation — Senior Level

## Focus: How to Optimize and How to Architect

---

## 1. Introduction

At the senior level, Go tooling becomes infrastructure. This level covers build system architecture, custom tooling, documentation generation pipelines, advanced `go generate` patterns, build constraints for multi-platform support, and integrating the Go toolchain into enterprise workflows.

---

## 2. Architecture of the Go Toolchain

### 2.1 How `go build` Works Internally

```
Source files (.go)
       │
       ▼
   Lexer/Parser (go/parser)
       │
       ▼
   Type Checker (go/types)
       │
       ▼
   SSA Builder (cmd/compile/internal/ssa)
       │
       ▼
   Backend (architecture-specific code gen)
       │
       ▼
   Linker (cmd/link)
       │
       ▼
   Binary
```

The build is cached at the package level: if a package's source files haven't changed, it's not recompiled.

### 2.2 Build Cache Architecture

```bash
# Location
go env GOCACHE  # typically ~/.cache/go-build

# Structure
~/.cache/go-build/
├── 00/ 01/ ... ff/     # hash-based sharded directories
└── trim.txt            # cache maintenance

# Each cache entry is identified by a hash of:
# - Source files content
# - Compiler flags
# - Build tags
# - Go version

# Warm cache: nearly instant rebuilds
# Cold cache: full compilation

# Trim cache to save disk space
go clean -cache           # remove all entries
go clean -testcache       # remove only test results
go clean -modcache        # remove downloaded modules
```

### 2.3 Module Proxy Architecture

```
Developer → GOPROXY → Module Source (GitHub, etc.)
              │
              ▼
        GONOSUMCHECK?
              │
        No → GONOSUMDB?
              │
        No → sum.golang.org (verify checksum)
```

For enterprise:
```bash
# Use corporate proxy
go env -w GOPROXY="https://proxy.company.com,direct"

# Skip public checksum for internal packages
go env -w GONOSUMDB="*.company.internal"

# Completely offline builds
go env -w GOPROXY="off"
go env -w GONOSUMCHECK="*"
```

---

## 3. Advanced `go doc` Usage

### 3.1 Programmatic Documentation Extraction

```go
package main

import (
    "fmt"
    "go/ast"
    "go/doc"
    "go/parser"
    "go/token"
)

func extractDocs(dir string) {
    fset := token.NewFileSet()
    pkgs, err := parser.ParseDir(fset, dir, nil, parser.ParseComments)
    if err != nil {
        panic(err)
    }

    for name, pkg := range pkgs {
        dpkg, err := doc.NewFromFiles(fset, pkg.Files, "module/path/"+name)
        if err != nil {
            continue
        }

        fmt.Printf("Package: %s\n", dpkg.Name)
        fmt.Printf("Doc: %s\n\n", dpkg.Doc)

        for _, fn := range dpkg.Funcs {
            fmt.Printf("  func %s\n  doc: %s\n", fn.Name, fn.Doc)
        }
        for _, t := range dpkg.Types {
            fmt.Printf("  type %s\n  doc: %s\n", t.Name, t.Doc)
            for _, m := range t.Methods {
                fmt.Printf("    method %s\n    doc: %s\n", m.Name, m.Doc)
            }
        }
    }
}
```

### 3.2 Custom Documentation Generation

```go
// Use golang.org/x/tools/go/packages for more powerful analysis
package main

import (
    "fmt"
    "golang.org/x/tools/go/packages"
)

func analyzePackage(pattern string) {
    cfg := &packages.Config{
        Mode: packages.NeedName |
              packages.NeedFiles |
              packages.NeedSyntax |
              packages.NeedTypes |
              packages.NeedTypesInfo,
    }

    pkgs, err := packages.Load(cfg, pattern)
    if err != nil {
        panic(err)
    }

    for _, pkg := range pkgs {
        fmt.Printf("Package: %s\n", pkg.Name)
        for _, f := range pkg.Syntax {
            fmt.Printf("  File: %s\n", f.Name.Name)
            ast.Inspect(f, func(n ast.Node) bool {
                if fn, ok := n.(*ast.FuncDecl); ok {
                    if fn.Doc != nil {
                        fmt.Printf("    %s: %s\n",
                            fn.Name.Name,
                            fn.Doc.Text())
                    }
                }
                return true
            })
        }
    }
}
```

---

## 4. Advanced `go generate` Patterns

### 4.1 Stringer Pattern

```go
// direction.go
package direction

//go:generate stringer -type=Direction -linecomment

// Direction represents a compass direction.
type Direction int

const (
    North Direction = iota // N
    East                   // E
    South                  // S
    West                   // W
)
```

After `go generate`:
```go
// direction_string.go (generated)
func (i Direction) String() string {
    return [...]string{"N", "E", "S", "W"}[i]
}
```

### 4.2 Interface Mock Generation

```go
// service.go
package service

//go:generate mockgen -source=service.go -destination=../mocks/service_mock.go

type UserService interface {
    GetUser(id int64) (*User, error)
    CreateUser(req CreateUserRequest) (*User, error)
    DeleteUser(id int64) error
}
```

### 4.3 Embed and Generate Combined Pattern

```go
// embed.go
package templates

import "embed"

//go:generate go run ./cmd/generate-templates

//go:embed *.html
var Templates embed.FS
```

```go
// cmd/generate-templates/main.go
//go:build ignore

package main

import (
    "html/template"
    "os"
)

func main() {
    // Generate template files from a database or remote source
    // These are then embedded via //go:embed
    tmpl := template.Must(template.New("").Parse("{{.Title}}"))
    f, _ := os.Create("index.html")
    tmpl.Execute(f, nil)
}
```

---

## 5. Build Tags and Platform-Specific Code

### 5.1 Modern Build Constraints (Go 1.17+)

```go
//go:build linux || darwin
// +build linux darwin  // keep for Go < 1.17 compatibility

package platform

// PlatformName returns the current platform name
func PlatformName() string {
    return "unix"
}
```

```go
//go:build windows

package platform

func PlatformName() string {
    return "windows"
}
```

### 5.2 Custom Build Tags for Testing

```go
//go:build integration

package mypackage_test

import (
    "testing"
)

// TestDatabaseIntegration only runs with: go test -tags integration
func TestDatabaseIntegration(t *testing.T) {
    // ... connects to real database
}
```

```bash
# Run only unit tests (default)
go test ./...

# Run with integration tests
go test -tags integration ./...

# Run only integration tests
go test -run TestDatabaseIntegration -tags integration ./...
```

### 5.3 File Naming Conventions vs Build Tags

```
Filename conventions (automatic build constraints):
  *_linux.go          → only on Linux
  *_darwin.go         → only on macOS
  *_windows.go        → only on Windows
  *_amd64.go          → only on amd64 architecture
  *_linux_amd64.go    → only on Linux amd64
  *_test.go           → only in test builds
```

---

## 6. Custom Linter Development

```go
// mylinter/mylinter.go
package mylinter

import (
    "go/ast"
    "go/token"

    "golang.org/x/tools/go/analysis"
)

var Analyzer = &analysis.Analyzer{
    Name: "nofmt",
    Doc:  "reports direct calls to fmt.Println in non-test files",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        if isTestFile(pass.Fset, file) {
            continue
        }
        ast.Inspect(file, func(n ast.Node) bool {
            call, ok := n.(*ast.CallExpr)
            if !ok {
                return true
            }
            sel, ok := call.Fun.(*ast.SelectorExpr)
            if !ok {
                return true
            }
            pkg, ok := sel.X.(*ast.Ident)
            if !ok {
                return true
            }
            if pkg.Name == "fmt" && sel.Sel.Name == "Println" {
                pass.Reportf(call.Pos(), "use log package instead of fmt.Println")
            }
            return true
        })
    }
    return nil, nil
}

func isTestFile(fset *token.FileSet, f *ast.File) bool {
    filename := fset.File(f.Pos()).Name()
    return len(filename) > 8 && filename[len(filename)-8:] == "_test.go"
}
```

---

## 7. `go vet` Analyzers Reference

```bash
# View all available analyzers
go doc cmd/vet

# Key built-in analyzers:
# asmdecl     — assembly function declarations
# assign      — useless assignments
# atomic      — common misuse of sync/atomic
# bools       — common mistakes with boolean operators
# buildtag    — malformed //go:build constraints
# cgocall     — violations of cgo pointer passing rules
# composites  — composite literal uses with missing field names
# copylocks    — locks passed by value
# directive   — go:directive in wrong position
# errorsas    — misuse of errors.As
# httpresponse — mistakes using net/http.ResponseWriter
# ifaceassert  — impossible interface type assertions
# loopclosure — loop variable capture in closures
# lostcancel  — context.CancelFunc not called
# nilfunc     — comparisons between func and nil
# printf      — Printf format string issues
# shift       — shifts equal to or exceeding integer width
# stdmethods  — method signature that satisfies common interfaces
# stringintconv — conversions from int to string (the string(65) = "A" bug!)
# structtag   — struct field tag format
# testinggoroutine — goroutines started in tests
# tests       — Test function naming and signatures
# timeformat  — incorrect time format strings
# unmarshal   — JSON/encoding unmarshal target issues
# unreachable — unreachable code
# unsafeptr   — unsafe.Pointer conversions
# unusedresult — calls that discard useful return values
```

---

## 8. Documentation Strategy for Large Projects

### 8.1 Documentation Levels

```
1. Package-level: What does this package do? When to use it?
2. Type-level: What is this type? What invariants does it have?
3. Method/function-level: What does this do? What are the parameters?
4. Field-level: What is this field for? What values are valid?
5. Code-level: Why is this implemented this way? (non-obvious logic)
```

### 8.2 Example-Based Documentation

```go
// example_test.go (in the package directory)
package ratelimit_test

import (
    "fmt"
    "time"
    "your/module/ratelimit"
)

// ExampleNew demonstrates creating a rate limiter.
func ExampleNew() {
    limiter := ratelimit.New(10)  // 10 requests/second
    start := time.Now()

    for i := 0; i < 3; i++ {
        limiter.Take()
        fmt.Printf("request %d at %v\n", i, time.Since(start).Round(time.Millisecond))
    }
    // Output:
    // request 0 at 0s
    // request 1 at 100ms
    // request 2 at 200ms
}

// ExampleLimiter_Take shows concurrent usage.
func ExampleLimiter_Take() {
    limiter := ratelimit.New(100)
    limiter.Take()  // blocks if at limit
    fmt.Println("got token")
    // Output: got token
}
```

Examples with `// Output:` comments are **executed during `go test`** — they're runnable documentation.

---

## 9. Advanced `go list` Usage

```bash
# Find all packages that import a specific package
go list -f '{{if .Imports}}{{.ImportPath}} imports{{end}}' ./...

# Find packages with test files
go list -f '{{if .TestGoFiles}}{{.ImportPath}}{{end}}' ./...

# Export build info as JSON
go list -json ./... | jq -r '"\(.ImportPath): \(.GoFiles | length) files"'

# Find dependency chain
go list -f '{{range .Deps}}{{.}} {{end}}' . | tr ' ' '\n' | sort -u

# Check for import cycles
go build ./... 2>&1 | grep "import cycle"

# List packages by update time (useful for CI caching)
go list -json ./... | jq -r '[.ImportPath, .GoFiles[]] | join(" ")'
```

---

## 10. Postmortems and System Failures

### Incident 1: Documentation Drift

**What happened:** A team maintained a microservice where the `go doc` comments became out of date over 18 months. The `CreateOrder` function's doc said it was synchronous, but it had been changed to async. Teams relying on the "synchronous" guarantee built systems that broke.

**Root cause:** Doc comments were not part of code review checklists. Changes to behavior were not matched with doc comment updates.

**Fix:**
1. Add `go doc` review to PR checklist
2. Use `//nolint:godot` comment for exceptions to avoid false flag on incomplete sentences
3. Install `godoc-check` in CI to enforce doc comment presence

### Incident 2: `go generate` Not Run After Refactor

**What happened:** An engineer renamed a Go interface (`ServiceV1` → `Service`). The mock was generated from the interface, but `go generate` wasn't re-run. The committed mock was stale. Tests passed (they used the old mock), but the code failed at runtime because the new interface was different.

**Root cause:** No CI check that generated code is up-to-date.

**Fix:**
```bash
# In CI: regenerate and check for diff
go generate ./...
git diff --exit-code
# Fails if generated files changed, meaning generate wasn't re-run
```

### Incident 3: Build Cache Corruption

**What happened:** After a `go` version upgrade, cached build artifacts from the old version caused intermittent compilation failures. The cache keys didn't properly invalidate on version changes in one environment.

**Root cause:** Unusual filesystem setup where `GOCACHE` was on a network drive shared between machines with different Go versions.

**Fix:**
```bash
# Each machine/CI job should have its own GOCACHE
# In CI:
go env -w GOCACHE=/tmp/go-build-cache-$RUNNER_ID
# Or: go clean -cache at start of each CI run
```

---

## 11. Performance Optimization for Large Projects

### 11.1 Parallel Builds

```bash
# go build is already parallel within itself
# But for build systems:
# -p flag controls parallelism
go build -p 8 ./...  # build with 8 parallel goroutines

# go test parallelism
go test -p 8 ./...   # run 8 test binaries in parallel
```

### 11.2 Build Cache in CI

```yaml
# GitHub Actions with Go build cache
- name: Cache Go modules and build
  uses: actions/cache@v3
  with:
    path: |
      ~/go/pkg/mod
      ~/.cache/go-build
    key: ${{ runner.os }}-go-${{ hashFiles('**/go.sum') }}
    restore-keys: |
      ${{ runner.os }}-go-
```

### 11.3 Trimming Binary Size

```bash
# Remove debug symbols and DWARF info
go build -ldflags="-s -w" .

# Combine with UPX for maximum compression
upx --best --lzma myapp

# Check binary size breakdown
go tool nm myapp | sort -k 2 -r | head -20
```

---

## 12. Enterprise Documentation Infrastructure

### 12.1 Private pkg.go.dev Alternative

For organizations with private packages, set up:

```bash
# Option 1: Run private godoc server
docker run -p 6060:6060 \
    -v $GOPATH:/go \
    golang:1.21 \
    godoc -http=:6060

# Option 2: Generate static HTML docs
go install golang.org/x/tools/cmd/godoc@latest
godoc -url /pkg/your/package > package-docs.html

# Option 3: Use pkgsite (pkg.go.dev codebase)
go install golang.org/x/pkgsite/cmd/pkgsite@latest
pkgsite -http=:6060
```

### 12.2 Documentation Testing with `go test`

Examples are compiled and run as part of `go test`:

```bash
# Run only example functions (as tests)
go test -run Example ./...

# Run with verbose to see output
go test -v -run Example ./...
```

---

## 13. `go vet` Custom Checks via GOFLAGS

```bash
# Add vet checks to all builds
go env -w GOFLAGS="-vet=all"

# Specific analysis only
go vet -printf ./...   # only check printf-style calls

# Disable a specific check
go vet -composites=false ./...

# Run analysis as part of build
go build -vet=all ./...

# Check new analyzers from golang.org/x/tools
go vet -vettool=$(which shadow) ./...  # shadow variable check
```

---

## 14. Toolchain Management

### 14.1 Managing Multiple Go Versions

```bash
# Go 1.21+ supports toolchain directive in go.mod
# go.mod:
go 1.21.0

toolchain go1.21.5  # exact version to use

# This allows: go get toolchain@go1.22.0
# And automatically downloads the required version
```

### 14.2 `go install` for Tools

```go
// tools.go — pin tool versions as Go dependencies
//go:build tools

package tools

import (
    _ "golang.org/x/tools/cmd/godoc"
    _ "github.com/golang/mock/mockgen"
    _ "honnef.co/go/tools/cmd/staticcheck"
)
```

```bash
# Install all pinned tools
go install golang.org/x/tools/cmd/godoc@latest
go install github.com/golang/mock/mockgen@latest

# Or use a script:
go list -m -f '{{.Path}} {{.Version}}' golang.org/x/tools | \
    xargs go install
```

---

## 15. Advanced Documentation Patterns

### 15.1 Deprecated Markers

```go
// OldFunction processes data in the legacy format.
//
// Deprecated: Use NewFunction instead, which provides better performance
// and returns errors instead of panicking on invalid input.
func OldFunction(data []byte) string {
    panic("not implemented")
}

// NewFunction processes data and returns the result or an error.
func NewFunction(data []byte) (string, error) {
    return "", nil
}
```

### 15.2 Internal Package Documentation

```go
// Package internal/auth provides authentication primitives.
// This package is internal and must not be imported from outside
// the parent module's path.
package auth
```

### 15.3 Documenting Panics and Contracts

```go
// MustParse parses s as a URL and returns the result.
// MustParse panics if s is not a valid URL.
// It is intended for use only in initialization code where
// program termination is acceptable.
func MustParse(s string) *url.URL {
    u, err := url.Parse(s)
    if err != nil {
        panic("invalid URL: " + err.Error())
    }
    return u
}
```

---

## 16. Code Examples (Senior)

### Example 1: Makefile with Full Toolchain

```makefile
.PHONY: all generate fmt vet lint test build clean

GOFLAGS ?=
GOTEST_FLAGS ?= -race -count=1

all: generate fmt vet lint test build

generate:
	go generate ./...

fmt:
	@echo "Running gofmt..."
	@if [ "$$(gofmt -l .)" != "" ]; then \
		echo "Unformatted files:"; \
		gofmt -l .; \
		exit 1; \
	fi

vet:
	go vet $(GOFLAGS) ./...

lint:
	golangci-lint run

test:
	go test $(GOTEST_FLAGS) $(GOFLAGS) ./...

build:
	go build $(GOFLAGS) -ldflags="-s -w" -o bin/app ./cmd/app

clean:
	go clean -cache -testcache
	rm -rf bin/

# Check that generated code is up to date
check-generated:
	go generate ./...
	git diff --exit-code
```

### Example 2: Doc Comment Linting

```bash
# Install doc comment linter
go install github.com/client9/misspell/cmd/misspell@latest

# Check for doc comment issues
golangci-lint run --enable godot,godox,godoc-check

# Custom script to check all exported symbols have docs
go list -json ./... | jq -r '
  .GoFiles[] as $f |
  (.Dir + "/" + $f)
' | xargs grep -L "^//"
```

### Example 3: Cross-Platform Build Script

```bash
#!/bin/bash
# build-all.sh — build for all major platforms

BINARY_NAME="myapp"
VERSION=$(git describe --tags --always)
BUILD_FLAGS="-ldflags=-X main.version=${VERSION} -s -w"

platforms=(
    "linux/amd64"
    "linux/arm64"
    "darwin/amd64"
    "darwin/arm64"
    "windows/amd64"
)

for platform in "${platforms[@]}"; do
    IFS='/' read -r -a split <<< "$platform"
    GOOS="${split[0]}"
    GOARCH="${split[1]}"

    output="${BINARY_NAME}-${GOOS}-${GOARCH}"
    if [ "$GOOS" == "windows" ]; then
        output="${output}.exe"
    fi

    echo "Building ${output}..."
    GOOS="$GOOS" GOARCH="$GOARCH" go build \
        ${BUILD_FLAGS} \
        -o "dist/${output}" \
        ./cmd/app

    if [ $? -ne 0 ]; then
        echo "Failed to build for ${platform}"
        exit 1
    fi
done

echo "All builds successful!"
ls -la dist/
```

---

## 17. Best Practices (Senior)

1. **Treat documentation as code** — doc comments fail code review just like bugs
2. **Automate generate/check in CI** — run `go generate` and `git diff --exit-code`
3. **Version your toolchain** — pin `go` version in `go.mod`, tools in `tools.go`
4. **Cache intelligently** — cache `GOMODCACHE` and `GOCACHE` separately
5. **Use build tags over file naming** — more explicit and easier to understand
6. **Document failure modes** — what can panic, what can fail, what are the invariants
7. **Ship with documentation** — `godoc` or equivalent should be part of your release process

---

## 18. Self-Assessment Checklist

- [ ] I can build for multiple platforms using GOOS/GOARCH
- [ ] I automate `go generate` verification in CI
- [ ] I write example functions that serve as tests
- [ ] I understand `go vet` analyzers and can configure them
- [ ] I can write a custom go analysis pass
- [ ] I manage tool versions via `tools.go`
- [ ] I use build tags for platform-specific and test-only code
- [ ] I can extract documentation programmatically with `go/doc`
- [ ] I design documentation architecture for large projects
- [ ] I can diagnose and fix build cache issues

---

## 19. Summary

At the senior level, Go tooling becomes a platform for team productivity. Key insights:
- **Build cache** is the foundation of fast incremental builds — understand and respect it
- **Documentation as API** — `go doc` output is the interface users see; treat it accordingly
- **Generate-then-commit** pattern ensures reproducibility without requiring all tools on every machine
- **Custom analyzers** enable team-specific quality rules beyond `go vet`
- **Cross-compilation** is a first-class feature — use it for distribution, not VMs

The deepest insight: Go's toolchain philosophy is that the tool should make the right thing easy and the wrong thing impossible. Understanding this philosophy helps you design your own tooling with the same principles.

---

## 20. Diagrams

### Build Pipeline Architecture

```
Developer Workstation              CI/CD Pipeline
─────────────────────              ──────────────────────
git commit                         git push
    │                                  │
    ▼                                  ▼
pre-commit hook:               CI workflow:
  go fmt --check                 go generate --check
  go vet ./...                   go fmt --check
                                 go vet ./...
                                 golangci-lint run
                                 go test -race ./...
                                 go build ./...
                                     │
                                     ▼
                               Artifacts:
                                 binary (all platforms)
                                 documentation (HTML)
                                 coverage report
```

### Documentation Hierarchy

```
pkg.go.dev / godoc server
         │
         ├── Package overview (package doc comment)
         │
         ├── Constants & Variables
         │
         ├── Functions
         │   ├── Signature
         │   ├── Doc comment
         │   └── Examples (from *_test.go)
         │
         ├── Types
         │   ├── Type doc + definition
         │   └── Methods (same as Functions)
         │
         └── Subdirectories
```
