# Go Commands & Documentation — Practical Tasks

---

## Task 1: Write a Fully Documented Package (Beginner)

### Description
Create a simple `geometry` package with complete documentation that would look professional on pkg.go.dev.

### Requirements
- Package-level doc comment
- All exported types, functions, and constants documented
- At least one example function that can be run as a test
- Pass `go vet ./...` with no warnings

### Starter Code
```go
// TODO: Add package-level documentation here
package geometry

import "math"

// TODO: Add doc comment for Shape
type Shape interface {
    // TODO: Add doc comment for Area
    Area() float64
    // TODO: Add doc comment for Perimeter
    Perimeter() float64
}

// TODO: Add doc comment for Circle
type Circle struct {
    // TODO: Add doc comment for Radius
    Radius float64
}

// TODO: Add doc comment for Area
func (c Circle) Area() float64 {
    return math.Pi * c.Radius * c.Radius
}

// TODO: Add doc comment for Perimeter
func (c Circle) Perimeter() float64 {
    return 2 * math.Pi * c.Radius
}

// TODO: Add doc comment for Rectangle
type Rectangle struct {
    // TODO: Add doc comment
    Width, Height float64
}

func (r Rectangle) Area() float64 {
    return r.Width * r.Height
}

func (r Rectangle) Perimeter() float64 {
    return 2 * (r.Width + r.Height)
}
```

Create a `geometry_test.go` file with at least one `Example*` function.

### Evaluation Criteria
- [ ] Package doc comment explains what the package does and how to use it
- [ ] All exported symbols have doc comments starting with the symbol name
- [ ] At least one `ExampleCircle_Area()` function in `_test.go`
- [ ] `go vet ./...` passes without warnings
- [ ] `go doc -all .` shows complete, readable documentation
- [ ] Example functions have `// Output:` comments and pass `go test`

---

## Task 2: Go Environment Inspector (Beginner)

### Description
Write a Go program that prints a formatted report of the current Go environment, using `os/exec` to run `go env -json` and parse the output.

### Requirements
- Run `go env -json` and parse the JSON output
- Display key environment variables in a formatted table
- Highlight if GOPROXY is set to non-default
- Show whether CGO is enabled

### Starter Code
```go
package main

import (
    "encoding/json"
    "fmt"
    "os/exec"
)

// EnvReport holds selected Go environment variables
type EnvReport struct {
    GOVERSION string
    GOROOT    string
    GOPATH    string
    GOMODCACHE string
    GOCACHE   string
    GOPROXY   string
    GOOS      string
    GOARCH    string
    CGO_ENABLED string
}

func getGoEnv() (*EnvReport, error) {
    // TODO: Run `go env -json` and unmarshal into EnvReport
    // Hint: use exec.Command("go", "env", "-json")
    // Then: cmd.Output() to get the JSON bytes
    // Then: json.Unmarshal to parse
    panic("not implemented")
}

func printReport(r *EnvReport) {
    // TODO: Print a formatted table like:
    // Go Version:  go1.21.0
    // GOROOT:      /usr/local/go
    // GOPATH:      /home/user/go
    // ...
    // GOPROXY:     [custom] https://proxy.company.com ⚠️
    panic("not implemented")
}

func main() {
    report, err := getGoEnv()
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    printReport(report)
}
```

### Evaluation Criteria
- [ ] Successfully runs `go env -json` and parses output
- [ ] Prints all required variables in a readable format
- [ ] Highlights non-default `GOPROXY` values
- [ ] Handles errors gracefully
- [ ] The program itself has doc comments

---

## Task 3: Documentation Quality Checker (Intermediate)

### Description
Write a tool that checks whether all exported symbols in a Go package have documentation comments, and reports which ones are missing.

### Requirements
- Use `go/parser` and `go/ast` to parse a Go source file
- Report all exported functions, types, and constants without doc comments
- Exit with code 1 if any documentation is missing
- Accept a directory path as command-line argument

### Starter Code
```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
    "path/filepath"
    "strings"
)

type MissingDoc struct {
    Name string
    Kind string // "func", "type", "const", "var"
    Line int
    File string
}

// checkFile parses a Go file and returns all exported symbols missing doc comments
func checkFile(filename string) ([]MissingDoc, error) {
    fset := token.NewFileSet()
    f, err := parser.ParseFile(fset, filename, nil, parser.ParseComments)
    if err != nil {
        return nil, err
    }

    var missing []MissingDoc

    ast.Inspect(f, func(n ast.Node) bool {
        switch decl := n.(type) {
        case *ast.FuncDecl:
            // TODO: check if exported and has doc comment
            // Hint: ast.IsExported(decl.Name.Name) && decl.Doc == nil
            _ = decl
        case *ast.GenDecl:
            // TODO: handle type, const, var declarations
            // Hint: iterate decl.Specs for *ast.TypeSpec, *ast.ValueSpec
            _ = decl
        }
        return true
    })

    return missing, nil
}

func main() {
    dir := "."
    if len(os.Args) > 1 {
        dir = os.Args[1]
    }

    var allMissing []MissingDoc
    // TODO: Walk directory, call checkFile for each .go file
    // Skip test files (*_test.go)
    // Skip files starting with generated header
    _ = filepath.Walk
    _ = strings.HasSuffix

    if len(allMissing) > 0 {
        for _, m := range allMissing {
            fmt.Printf("%s:%d: exported %s %q missing doc comment\n",
                m.File, m.Line, m.Kind, m.Name)
        }
        os.Exit(1)
    }
    fmt.Println("All exported symbols are documented!")
}
```

### Evaluation Criteria
- [ ] Correctly identifies exported functions without doc comments
- [ ] Correctly identifies exported types without doc comments
- [ ] Skips test files
- [ ] Reports file, line number, symbol name, and kind
- [ ] Exits with code 1 when issues are found
- [ ] Works on the current directory by default

---

## Task 4: Build Tag Demonstrator (Intermediate)

### Description
Create a multi-platform greeting application that uses build tags to provide platform-specific implementations.

### Requirements
- Create a `platform` package with a `PlatformName()` function
- Provide implementations for: linux, darwin, windows
- Provide a fallback for unknown platforms
- Write a main program that uses the platform package
- Document all exported symbols

### File Structure
```
platform/
├── platform_linux.go    (//go:build linux)
├── platform_darwin.go   (//go:build darwin)
├── platform_windows.go  (//go:build windows)
├── platform_other.go    (//go:build !linux && !darwin && !windows)
└── platform.go          (doc.go with package comment)
main.go
```

### Starter Code for `platform/platform.go`

```go
// Package platform provides OS-specific information.
// It automatically selects the correct implementation
// based on the build target operating system.
//
// Usage:
//
//	name := platform.PlatformName()
//	fmt.Printf("Running on: %s\n", name)
package platform
```

### Starter Code for `platform/platform_linux.go`

```go
//go:build linux
// +build linux

package platform

// PlatformName returns the name of the current operating system.
func PlatformName() string {
    // TODO: return "Linux"
    panic("not implemented")
}

// PlatformIcon returns an emoji representing the platform.
func PlatformIcon() string {
    // TODO: return "🐧"
    panic("not implemented")
}
```

### Evaluation Criteria
- [ ] Build tags are correct (`//go:build linux`, etc.)
- [ ] `go build -tags ...` selects the correct implementation
- [ ] Fallback file compiles when no specific platform tag matches
- [ ] All exported functions are documented
- [ ] `go vet ./...` passes
- [ ] Main program uses the platform package correctly

---

## Task 5: Generate an Enum with Stringer (Intermediate)

### Description
Use `go generate` and the `stringer` tool to automatically generate `String()` methods for an enum type.

### Requirements
- Install `stringer`: `go install golang.org/x/tools/cmd/stringer@latest`
- Create an enum type with `//go:generate` directive
- Run `go generate ./...`
- Verify the generated `String()` method is correct
- Write tests that use the generated `String()` method

### Starter Code
```go
// status.go
package order

// OrderStatus represents the current state of an order.
//go:generate stringer -type=OrderStatus -output=order_status_string.go

// OrderStatus values represent the lifecycle of an order.
type OrderStatus int

const (
    // StatusPending indicates the order has been received but not yet processed.
    StatusPending OrderStatus = iota
    // StatusProcessing indicates the order is being prepared.
    StatusProcessing
    // StatusShipped indicates the order has been dispatched.
    StatusShipped
    // StatusDelivered indicates the order has been delivered.
    StatusDelivered
    // StatusCancelled indicates the order was cancelled.
    StatusCancelled
)
```

```go
// status_test.go
package order

import "testing"

func TestOrderStatusString(t *testing.T) {
    tests := []struct {
        status OrderStatus
        want   string
    }{
        {StatusPending, "StatusPending"},
        {StatusShipped, "StatusShipped"},
        // TODO: add more cases
    }
    for _, tc := range tests {
        if got := tc.status.String(); got != tc.want {
            t.Errorf("status %d: got %q, want %q", tc.status, got, tc.want)
        }
    }
}
```

### Evaluation Criteria
- [ ] `//go:generate` directive is present and correct
- [ ] `go generate ./...` produces a `*_string.go` file
- [ ] Generated `String()` method returns correct names
- [ ] Tests pass with `go test ./...`
- [ ] Generated file has a comment saying it was generated

---

## Task 6: Module Dependency Reporter (Intermediate)

### Description
Write a tool that uses `go list -json` to analyze a Go module's dependencies and generate a report.

### Requirements
- Run `go list -m -json all` and parse the output
- Count direct vs indirect dependencies
- Identify the oldest and newest dependencies by version
- Check if any dependency is `replace`d in `go.mod`
- Output a formatted summary report

### Starter Code
```go
package main

import (
    "encoding/json"
    "fmt"
    "os/exec"
    "strings"
)

// Module represents a Go module from `go list -m -json all`
type Module struct {
    Path     string
    Version  string
    Indirect bool
    Replace  *Module
    Error    *struct {
        Err string
    }
}

func listModules() ([]Module, error) {
    cmd := exec.Command("go", "list", "-m", "-json", "all")
    out, err := cmd.Output()
    if err != nil {
        return nil, fmt.Errorf("go list failed: %w", err)
    }

    // go list -json outputs multiple JSON objects, not an array
    // Use json.Decoder to read them one by one
    var modules []Module
    dec := json.NewDecoder(strings.NewReader(string(out)))
    for dec.More() {
        var m Module
        if err := dec.Decode(&m); err != nil {
            return nil, err
        }
        modules = append(modules, m)
    }
    return modules, nil
}

func generateReport(modules []Module) {
    // TODO: Print:
    // - Total modules: N
    // - Direct dependencies: N
    // - Indirect dependencies: N
    // - Replaced modules: list them
    // - Module list (direct only): sorted
    panic("not implemented")
}

func main() {
    modules, err := listModules()
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    generateReport(modules)
}
```

### Evaluation Criteria
- [ ] Correctly parses multi-object JSON from `go list`
- [ ] Correctly distinguishes direct from indirect dependencies
- [ ] Lists replaced modules with their replacements
- [ ] Output is clean and readable
- [ ] Tool itself has proper doc comments

---

## Task 7: Custom go vet Analyzer (Advanced)

### Description
Write a custom Go analyzer that reports when `fmt.Println` is used outside of test files. This demonstrates understanding of the `go/analysis` framework.

### Requirements
- Use `golang.org/x/tools/go/analysis`
- Report all calls to `fmt.Println` in non-test files
- Include file and line number in the report
- Make it usable as a standalone tool AND as part of `golangci-lint`

### Starter Code
```go
package nofmtprintln

import (
    "go/ast"
    "strings"

    "golang.org/x/tools/go/analysis"
    "golang.org/x/tools/go/analysis/singlechecker"
)

// Analyzer reports calls to fmt.Println in non-test files.
var Analyzer = &analysis.Analyzer{
    Name: "nofmtprintln",
    Doc:  "reports uses of fmt.Println in non-test code",
    Run:  run,
}

func run(pass *analysis.Pass) (interface{}, error) {
    for _, file := range pass.Files {
        // TODO: Check if this is a test file
        filename := pass.Fset.File(file.Pos()).Name()
        if strings.HasSuffix(filename, "_test.go") {
            continue
        }

        // TODO: Walk the AST looking for fmt.Println calls
        // Hint: use ast.Inspect
        // Look for *ast.CallExpr where:
        //   Fun is *ast.SelectorExpr
        //   Fun.X is *ast.Ident with Name == "fmt"
        //   Fun.Sel is *ast.Ident with Name == "Println"
        // Then call: pass.Reportf(call.Pos(), "use log package instead of fmt.Println")
        _ = ast.Inspect
        _ = file
    }
    return nil, nil
}

// Main makes this a standalone tool
func Main() {
    singlechecker.Main(Analyzer)
}
```

```go
// main.go (in cmd/nofmtprintln/)
package main

import "your/module/nofmtprintln"

func main() {
    nofmtprintln.Main()
}
```

### Evaluation Criteria
- [ ] Analyzer correctly finds `fmt.Println` calls
- [ ] Test files are excluded
- [ ] Reports include file, line number, and message
- [ ] Can be run: `go vet -vettool=./nofmtprintln ./...`
- [ ] Has proper documentation

---

## Task 8: `go doc` Web Server Wrapper (Advanced)

### Description
Build a simple HTTP server that wraps `go doc` and serves documentation in a browser-friendly format (without requiring godoc installation).

### Requirements
- Accept package path as URL parameter
- Run `go doc` and format the output as HTML
- Support linking between packages
- Handle errors gracefully

### Starter Code
```go
package main

import (
    "fmt"
    "html"
    "net/http"
    "os/exec"
    "strings"
)

func docHandler(w http.ResponseWriter, r *http.Request) {
    pkg := r.URL.Query().Get("pkg")
    if pkg == "" {
        pkg = "fmt"  // default
    }

    // TODO: Run `go doc -all <pkg>` and get output
    cmd := exec.Command("go", "doc", "-all", pkg)
    out, err := cmd.Output()
    if err != nil {
        // TODO: Handle error — show error page
        http.Error(w, "Package not found: "+pkg, http.StatusNotFound)
        return
    }

    // TODO: Format the output as HTML
    // 1. Escape HTML special characters
    // 2. Add heading formatting (lines starting with "func", "type", "const")
    // 3. Wrap code blocks in <pre><code>
    // 4. Add a simple search box
    // 5. Render the response

    w.Header().Set("Content-Type", "text/html; charset=utf-8")
    fmt.Fprintf(w, `<html>
<head><title>Go Docs: %s</title></head>
<body>
<form><input name="pkg" value="%s"><button>Look up</button></form>
<pre>%s</pre>
</body></html>`,
        html.EscapeString(pkg),
        html.EscapeString(pkg),
        html.EscapeString(string(out)))

    _ = strings.Contains
}

func main() {
    http.HandleFunc("/", docHandler)
    fmt.Println("Go doc server at http://localhost:8080/?pkg=fmt")
    http.ListenAndServe(":8080", nil)
}
```

### Evaluation Criteria
- [ ] Server starts and responds to requests
- [ ] `go doc` output is displayed for valid packages
- [ ] Invalid packages show a helpful error
- [ ] HTML is properly escaped (no XSS)
- [ ] Form allows looking up different packages
- [ ] Server handles concurrent requests safely

---

## Task 9: CI Format Gate (Advanced)

### Description
Write a GitHub Actions workflow AND a local pre-commit hook that enforce:
1. All files are `go fmt` formatted
2. `go vet` passes
3. All exported symbols are documented
4. Generated files are up to date

### Deliverables

**File 1: `.github/workflows/quality.yml`**
```yaml
name: Code Quality

on:
  push:
    branches: [main]
  pull_request:

jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      # TODO: Add steps for:
      # 1. Checkout code
      # 2. Setup Go
      # 3. Check formatting (fail if unformatted)
      # 4. Run go vet
      # 5. Run go generate and check for diff
      # 6. (optional) Run golangci-lint
```

**File 2: `scripts/pre-commit.sh`**
```bash
#!/bin/bash
set -e

echo "Running pre-commit checks..."

# TODO: Check 1: formatting
# Run gofmt -l and fail if output is non-empty

# TODO: Check 2: vet
# Run go vet ./...

# TODO: Check 3: documentation
# Run your doc checker from Task 3 if available

# TODO: Check 4: build
# Run go build ./... to catch compile errors

echo "All checks passed!"
```

**File 3: `Makefile`**
```makefile
.PHONY: fmt vet generate check all

# TODO: Implement all targets:
# fmt: run go fmt
# vet: run go vet
# generate: run go generate and check diff
# check: run all checks without fixing
# all: fmt + vet + generate + test + build
```

### Evaluation Criteria
- [ ] GitHub Actions workflow is valid YAML
- [ ] Workflow correctly fails on unformatted code
- [ ] Pre-commit hook is executable and works locally
- [ ] Makefile has all required targets
- [ ] Targets are documented with comments

---

## Task 10: Package Documentation Site Generator (Advanced)

### Description
Build a tool that uses `go/doc` and `go/parser` to generate a static HTML documentation site for a Go package — similar to a simplified pkg.go.dev.

### Requirements
- Parse a Go package directory
- Extract package doc, function docs, type docs, and examples
- Generate HTML output with:
  - Table of contents with anchor links
  - Syntax-highlighted code snippets
  - Collapsible sections
- Output to a `docs/` directory

### Starter Code
```go
package main

import (
    "fmt"
    "go/ast"
    "go/doc"
    "go/parser"
    "go/printer"
    "go/token"
    "html/template"
    "os"
    "strings"
)

// PackageData holds extracted documentation for a package
type PackageData struct {
    Name     string
    Doc      string
    Funcs    []FuncData
    Types    []TypeData
    Examples []ExampleData
}

// FuncData holds documentation for a single function
type FuncData struct {
    Name      string
    Signature string
    Doc       string
}

// TypeData holds documentation for a type
type TypeData struct {
    Name    string
    Doc     string
    Methods []FuncData
}

// ExampleData holds an example function
type ExampleData struct {
    Name string
    Code string
    Doc  string
}

// extractPackage extracts documentation from a directory
func extractPackage(dir string) (*PackageData, error) {
    fset := token.NewFileSet()
    pkgs, err := parser.ParseDir(fset, dir, nil, parser.ParseComments)
    if err != nil {
        return nil, err
    }

    // TODO: Use go/doc to extract documentation
    // Hint: doc.NewFromFiles(fset, files, importPath)
    _ = doc.NewFromFiles
    _ = ast.File{}
    _ = printer.Fprint

    return &PackageData{}, nil
}

const htmlTemplate = `<!DOCTYPE html>
<html>
<head>
  <title>{{.Name}} - Go Documentation</title>
  <style>
    body { font-family: monospace; max-width: 900px; margin: 0 auto; padding: 20px; }
    h1 { color: #007d9c; }
    pre { background: #f4f4f4; padding: 10px; overflow-x: auto; }
    .func-name { color: #007d9c; font-weight: bold; }
    .doc { color: #555; margin: 5px 0 15px 0; }
  </style>
</head>
<body>
  <h1>package {{.Name}}</h1>
  <p class="doc">{{.Doc}}</p>

  <h2>Functions</h2>
  {{range .Funcs}}
  <div>
    <h3 class="func-name" id="{{.Name}}">{{.Name}}</h3>
    <pre>{{.Signature}}</pre>
    <p class="doc">{{.Doc}}</p>
  </div>
  {{end}}

  <h2>Types</h2>
  {{range .Types}}
  <div>
    <h3 id="{{.Name}}">{{.Name}}</h3>
    <p class="doc">{{.Doc}}</p>
    {{range .Methods}}
    <h4>func ({{$.Name}}) {{.Name}}</h4>
    <pre>{{.Signature}}</pre>
    <p class="doc">{{.Doc}}</p>
    {{end}}
  </div>
  {{end}}
</body>
</html>`

func generateHTML(data *PackageData, outDir string) error {
    tmpl, err := template.New("docs").Parse(htmlTemplate)
    if err != nil {
        return err
    }

    if err := os.MkdirAll(outDir, 0755); err != nil {
        return err
    }

    f, err := os.Create(outDir + "/index.html")
    if err != nil {
        return err
    }
    defer f.Close()

    return tmpl.Execute(f, data)
}

func main() {
    dir := "."
    if len(os.Args) > 1 {
        dir = os.Args[1]
    }

    data, err := extractPackage(dir)
    if err != nil {
        fmt.Fprintln(os.Stderr, "Error:", err)
        os.Exit(1)
    }

    if err := generateHTML(data, "docs"); err != nil {
        fmt.Fprintln(os.Stderr, "Error:", err)
        os.Exit(1)
    }

    fmt.Println("Documentation generated in ./docs/index.html")
    _ = strings.TrimSpace
}
```

### Evaluation Criteria
- [ ] Correctly extracts package, function, and type documentation
- [ ] Generated HTML renders in a browser
- [ ] All exported symbols appear in the output
- [ ] Links between types and their methods work
- [ ] The tool itself has proper documentation

---

## Tips for All Tasks

1. **Always run `go doc` on packages you use** — check function signatures before using
2. **Run `go vet ./...` after completing each task** — fix all warnings
3. **Write doc comments as you code** — don't leave them for last
4. **Test your `go generate` directives** — make sure they produce the expected output
5. **Use `go list ./...`** to verify your package structure is correct
