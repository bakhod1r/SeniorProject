# Go Commands & Documentation — Professional Level

## Focus: What Happens Under the Hood

---

## 1. How `go build` Works Internally

### 1.1 Build Pipeline

The `go build` command is not a simple compiler invocation. It orchestrates a multi-phase pipeline:

**Phase 1: Package Resolution**
```
go build ./cmd/server
    │
    ▼
pkg/graph.go — builds a dependency graph
    │
    ├── reads all go.mod files
    ├── resolves import paths to filesystem paths
    └── detects import cycles
```

**Phase 2: Compilation (per package, parallel)**
```
For each package in topological order:
    1. go/parser   — parse .go files to AST
    2. go/types    — type-check the AST
    3. gc           — compile to object files (.a)
    4. Write to build cache
```

**Phase 3: Linking**
```
cmd/link:
    1. Read all .a files
    2. Dead code elimination
    3. Relocations
    4. Write ELF/Mach-O/PE binary
```

### 1.2 Source of `go` Command

The `go` command source lives at:
```
$GOROOT/src/cmd/go/
    ├── internal/
    │   ├── build/      — package loading
    │   ├── work/       — build actions
    │   ├── load/       — package graph
    │   ├── modload/    — module loading
    │   └── cache/      — build cache
    └── main.go
```

---

## 2. Runtime Deep Dive: How `go doc` Works

### 2.1 `go doc` Implementation

`go doc` uses the `go/doc` package from the standard library. It:

1. Calls `go/packages` to load the package
2. Parses all `.go` files with `go/parser` (including unexported symbols if `-u`)
3. Uses `go/doc.NewFromFiles` to extract documentation from AST
4. Formats the output using `go/printer`

Key source: `$GOROOT/src/cmd/doc/`

### 2.2 Doc Comment Format Specification

```go
// The specification for doc comments (Go 1.19+):

// Paragraphs: blank line separates paragraphs
// Links: [text] or [text][url]
// Headings: A line starting with a capital letter and ending with no punctuation
// Code blocks: lines indented with a tab
// Lists: lines starting with - or *

// Example of full spec:
// Package example demonstrates doc comment formatting.
//
// Basic usage:
//
//	example.New()    // tab-indented = code block
//
// Features
//
// The package supports:
//   - fast operations
//   - concurrent access
//
// See [Go docs] for more information.
//
// [Go docs]: https://go.dev/doc
package example
```

---

## 3. Compiler Perspective: `go build` Flags

### 3.1 Compiler Flags (-gcflags)

```bash
# View all compiler flags
go tool compile -help

# Key flags:
go build -gcflags='-m'        # print optimization decisions
go build -gcflags='-m -m'     # verbose optimization decisions
go build -gcflags='-S'        # print assembly output
go build -gcflags='-N'        # disable optimizations
go build -gcflags='-l'        # disable inlining
go build -gcflags='-e'        # report all errors
go build -gcflags='all=-m'    # apply to all packages
```

### 3.2 Linker Flags (-ldflags)

```bash
# View all linker flags
go tool link -help

# Key flags:
go build -ldflags='-s'              # strip symbol table
go build -ldflags='-w'              # strip DWARF debug info
go build -ldflags='-X main.version=1.0'  # set variable value
go build -ldflags='-extldflags=-static'  # static binary (CGO)

# Common combination for releases:
go build -ldflags='-s -w -X main.Version=v1.2.3' .
```

### 3.3 Escape Analysis Output

```bash
go build -gcflags='-m' ./...
# ./main.go:10:13: inlining call to fmt.Println
# ./main.go:15:2: moved to heap: x
# ./main.go:20:5: does not escape
```

Understanding escape analysis helps optimize conversions (see Type Conversion professional.md).

---

## 4. Memory Layout of Build Artifacts

### 4.1 Object File (.a) Structure

Each compiled package produces a `.a` archive containing:
```
package archive (.a):
├── Package header (name, deps, build ID)
├── Export data (types, functions, constants)
│   └── Used by compiler for type checking other packages
├── Object file (machine code)
└── Inline information (for cross-package inlining)
```

### 4.2 Binary Sections

```
ELF binary (Linux):
├── .text       — executable code
├── .rodata     — read-only data (string literals, type descriptors)
├── .data       — initialized data (global vars)
├── .bss        — uninitialized data
├── .symtab     — symbol table (stripped with -s)
└── .debug_*    — DWARF debug info (stripped with -w)

Inspect with:
go tool nm myapp          # symbol table
go tool objdump myapp     # disassembly
readelf -S myapp          # section headers
```

---

## 5. `go vet` Under the Hood

### 5.1 Analyzer Framework

`go vet` is built on the `golang.org/x/tools/go/analysis` framework:

```go
// Each analyzer has this structure:
type Analyzer struct {
    Name     string
    Doc      string
    Flags    flag.FlagSet
    Run      func(*Pass) (interface{}, error)
    Requires []*Analyzer  // dependencies between analyzers
    ResultType reflect.Type
    FactTypes  []Fact
}

// A Pass gives the analyzer access to:
type Pass struct {
    Fset         *token.FileSet    // position information
    Files        []*ast.File       // syntax trees
    OtherFiles   []string          // non-Go files
    Pkg          *types.Package    // type information
    TypesInfo    *types.Info       // detailed type info
    ResultOf     map[*Analyzer]interface{}  // results from Requires
    Report       func(Diagnostic)  // report a problem
    // ...
}
```

### 5.2 How `printf` Analyzer Works

The `printf` analyzer (detects mismatched format strings):
1. Finds all calls to `fmt.Printf`-style functions
2. Extracts the format string argument (if constant)
3. Parses the format verbs
4. Checks that the number and types of remaining args match
5. Reports mismatches

```go
// Simplified printf check logic:
func checkPrintf(pass *analysis.Pass, call *ast.CallExpr, fn *types.Func) {
    // Get format string argument
    formatArg := call.Args[fn.Params().At(0).Index()]
    
    // Only check if format is a string constant
    val, ok := pass.TypesInfo.Types[formatArg]
    if !ok || val.Value == nil {
        return // dynamic format string, can't check
    }
    
    format := constant.StringVal(val.Value)
    
    // Parse verbs and check against remaining args
    args := call.Args[1:]
    checkFormat(pass, call, format, args, fn)
}
```

---

## 6. Module System Internals

### 6.1 go.mod and go.sum

```go
// go.mod is parsed by cmd/go/internal/modfile
// It's a structured text file (NOT Go syntax)

// module path
module github.com/example/myapp

// minimum Go version required
go 1.21

// direct dependencies
require (
    github.com/gin-gonic/gin v1.9.1
    golang.org/x/sync v0.3.0
)

// indirect dependencies (transitive)
require (
    github.com/gin-contrib/sse v0.1.0 // indirect
)
```

```
// go.sum contains:
// module@version h1:hash
// module@version/go.mod h1:hash

github.com/gin-gonic/gin v1.9.1 h1:4idEAncQnU5cB7BeOkPtxjfCSye0AAm1R0RVIqJ+Jmg=
github.com/gin-gonic/gin v1.9.1/go.mod h1:hPGkbOQB1y4ynMTBR+wr7rX4j5XJOVvqQRLiXFn3JQ=
```

### 6.2 Module Download Sequence

```
go get github.com/foo/bar@v1.2.3
    │
    ▼
1. Check GOMODCACHE (~/.go/pkg/mod/github.com/foo/bar@v1.2.3)
    │
    If not cached:
    ▼
2. GOPROXY (proxy.golang.org)
    │  GET https://proxy.golang.org/github.com/foo/bar/@v/v1.2.3.info
    │  GET https://proxy.golang.org/github.com/foo/bar/@v/v1.2.3.mod
    │  GET https://proxy.golang.org/github.com/foo/bar/@v/v1.2.3.zip
    │
    ▼
3. GONOSUMDB check?
    │  No → verify hash against sum.golang.org
    │
    ▼
4. Extract to GOMODCACHE
    │
    ▼
5. Update go.mod and go.sum
```

---

## 7. Assembly Output Analysis

### 7.1 Reading `go doc` Assembly

```bash
# Show assembly for a specific function
go tool compile -S -N -l main.go | grep -A 20 "main.main:"

# Using objdump
go build -gcflags='-S' ./... 2>&1 | head -50
```

### 7.2 How `gofmt` Works Internally

`gofmt` uses the `go/format` package, which uses `go/printer`:

```
Source code (text)
    │
    ▼
go/scanner (lexer)
    │  tokenizes: keywords, identifiers, operators, literals
    ▼
go/parser
    │  builds AST (abstract syntax tree)
    ▼
go/printer
    │  prints AST with canonical formatting
    │  (always uses tabs for indentation)
    │  (always puts opening brace on same line)
    │  (always sorts import groups)
    ▼
Formatted source code (text)
```

If the source has syntax errors, `gofmt` fails — it needs a valid AST.

---

## 8. Performance Internals

### 8.1 Build Cache Hashing

The build cache key is computed from:
```
SHA256(
    source files content,
    compiler version,
    compiler flags,
    environment variables (GOOS, GOARCH, CGO_ENABLED),
    dependencies' cache keys (recursive)
)
```

This means a change in any dependency invalidates the build cache for all packages that depend on it.

### 8.2 Parallel Build Algorithm

```
The build scheduler (cmd/go/internal/work):

1. Build a dependency graph (DAG)
2. Start a goroutine pool (size = GOMAXPROCS)
3. Ready queue: packages with all dependencies built
4. When a package finishes, check if any new packages are now ready
5. Continue until all packages are built

The scheduler uses a semaphore to limit concurrent compilation
(too many parallel compilations can exhaust memory)
```

### 8.3 `go test` Caching

```bash
# Test results are cached too (since Go 1.10)
go test ./...      # runs tests
go test ./...      # uses cached result if nothing changed: "ok  package (cached)"

# Force re-run
go test -count=1 ./...    # count=1 disables test caching
go clean -testcache       # clear all cached test results

# Cache key includes:
# - source files
# - test binary
# - GOMAXPROCS (not by default, only if test uses it)
# - environment variables passed to test
```

---

## 9. Security Internals

### 9.1 Sum Database Protocol

```
Client → sum.golang.org
    GET /lookup/github.com/foo/bar@v1.2.3
    Response: 
        tree size and hash
        hash line for module
        hash line for go.mod
        signed transparency tree head
```

The sum database uses a Merkle tree (append-only log). The client:
1. Verifies the module hash against the log
2. Verifies the log is append-only (using consistency proofs)
3. Stores verified hashes in `go.sum`

This prevents supply-chain attacks where a module is modified after being published.

### 9.2 GONOSUMCHECK vs GONOSUMDB

```
GONOSUMDB: patterns of modules to skip checksum DB lookup
           (but still verify against local go.sum)

GONOSUMCHECK: patterns of modules to skip ALL checksum checking
              (dangerous — use only for fully controlled environments)
              
GONOSUMCHECK=*  means "trust everything" — appropriate for:
    - hermetic builds in a trusted environment
    - development with local replace directives
```

---

## 10. `godoc` HTTP Server Internals

```go
// The godoc server serves:
// /pkg/             — list of all packages
// /pkg/fmt/         — package documentation
// /src/fmt/         — source code
// /search           — full-text search

// It uses the same go/doc package as go doc
// but renders to HTML using templates

// Source: golang.org/x/tools/cmd/godoc/
// Key files:
// - godoc.go: main server
// - vfs/: virtual file system for reading source
// - analysis/: cross-reference analysis (type info, callers, etc.)
```

---

## 11. Source Code References

Key files in the Go source tree related to tooling:

```
$GOROOT/src/
├── cmd/
│   ├── go/              — the go command
│   ├── doc/             — go doc implementation
│   ├── gofmt/           — gofmt command
│   ├── vet/             — go vet command
│   ├── compile/         — Go compiler
│   └── link/            — Go linker
├── go/
│   ├── ast/             — abstract syntax tree types
│   ├── parser/          — Go parser
│   ├── printer/         — AST-to-source printer (used by gofmt)
│   ├── doc/             — documentation extraction
│   ├── format/          — high-level formatting (used by gofmt)
│   └── types/           — type checker
└── golang.org/x/tools/
    ├── go/analysis/     — analyzer framework (used by go vet)
    ├── go/packages/     — package loading
    └── cmd/godoc/       — godoc web server
```

---

## 12. Environment Variable Internals

```bash
# GOENV file location
go env GOENV
# ~/.config/go/env

# Format of the env file (key=value, one per line):
# GOPROXY=https://proxy.golang.org,direct
# GONOSUMDB=*.internal.example.com

# Precedence (highest to lowest):
# 1. CLI flags (go build -ldflags=...)
# 2. Environment variables (export GOOS=linux)
# 3. GOENV file (go env -w GOOS=linux)
# 4. Computed defaults (GOPATH defaults to ~/go)

# Why this matters:
# A user's GOENV file can silently modify behavior
# Always check: go env GOPROXY GONOSUMDB GOFLAGS
```

---

## 13. `go list -json` Structure

```go
// The JSON output of `go list -json .` represents this struct:
type Package struct {
    Dir           string   // directory containing package sources
    ImportPath    string   // import path of package in dir
    ImportComment string   // path in package comment on package statement
    Name          string   // package name
    Doc           string   // package documentation string
    Target        string   // install path
    Shlib         string   // the shared library that contains this package (only set when -linkshared)
    Goroot        bool     // is this package in the Go root?
    Standard      bool     // is this package part of the standard Go library?
    Stale         bool     // would 'go install' do anything for this package?
    Root          string   // Go root or Go path dir containing this package
    ConflictDir   string   // this directory shadows Dir in $GOPATH
    BinaryOnly    bool     // binary-only package: cannot be recompiled from sources
    ForTest       string   // package is only for use in named test
    Export        string   // file containing export data (when using -export)
    BuildID       string   // build ID of the compiled package
    Module        *Module  // info about package's module, if any (can be nil)
    Match         []string // command-line patterns matching this package
    DepOnly       bool     // package is only a dependency, not explicitly listed
    GoFiles       []string // .go source files (excluding CgoFiles, TestGoFiles, XTestGoFiles)
    CgoFiles      []string // .go source files that import "C"
    CompiledGoFiles []string // .go files presented to compiler
    IgnoredGoFiles []string // .go source files ignored due to build constraints
    IgnoredOtherFiles []string // non-.go source files ignored due to build constraints
    CFiles        []string // .c source files
    CXXFiles      []string // .cc, .cxx and .cpp source files
    MFiles        []string // .m source files
    HFiles        []string // .h, .hh, .hpp and .hxx source files
    FFiles        []string // .f source files (Fortran)
    SFiles        []string // .s source files
    SwigFiles     []string // .swig files
    SwigCXXFiles  []string // .swigcxx files
    SysoFiles     []string // .syso object files to add to archive
    TestGoFiles   []string // _test.go files in package
    XTestGoFiles  []string // _test.go files outside package
    CgoCFLAGS     []string // cgo: flags for C compiler
    CgoCPPFLAGS   []string // cgo: flags for C preprocessor
    CgoCXXFLAGS   []string // cgo: flags for C++ compiler
    CgoFFLAGS     []string // cgo: flags for Fortran compiler
    CgoLDFLAGS    []string // cgo: flags for linker
    CgoPkgConfig  []string // cgo: pkg-config names
    Imports       []string // import paths used by this package
    ImportMap     map[string]string // map from source import to ImportPath (identity entries omitted)
    Deps          []string // all (recursively) imported packages
    TestImports   []string // imports from TestGoFiles
    XTestImports  []string // imports from XTestGoFiles
    TestEmbedFiles []string // embed patterns from TestGoFiles
    XTestEmbedFiles []string // embed patterns from XTestGoFiles
}
```

---

## 14. Summary

Professional-level understanding of Go commands and documentation reveals:

1. **`go build` is an orchestrator** — it manages compilation, caching, and linking as a pipeline
2. **Build cache keys are comprehensive** — any change to source, flags, or Go version invalidates exactly the affected packages
3. **`go doc` uses `go/doc`** — the same AST-based documentation extraction used by pkg.go.dev
4. **`go vet` uses the analysis framework** — each check is an independent `analysis.Analyzer`
5. **Module checksums use Merkle trees** — cryptographically verified, append-only transparency log
6. **`gofmt` reprintings AST** — parse → AST → reprint; errors mean no formatting
7. **Parallel build scheduling** — topological sort of dependency graph with goroutine pool
8. **Test result caching** — cached by a hash of source + binary + environment
9. **GOENV file** — user-level persistent settings with defined precedence
10. **go list -json** exposes the full package metadata model used internally

Understanding these internals enables you to debug build issues, optimize CI pipelines, write custom tooling, and make architecture decisions that work with the Go toolchain rather than against it.
