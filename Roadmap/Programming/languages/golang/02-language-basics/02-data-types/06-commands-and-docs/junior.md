# Go Commands & Documentation — Junior Level

## 1. Introduction

**What is the Go Toolchain?**

Go comes with a powerful set of command-line tools that help you write, build, test, format, and document your code. These tools are invoked with the `go` command followed by a subcommand.

**How to use them:**
```bash
go <command> [arguments]
```

**Why this matters:** As a Go developer, you'll use these commands every day. Knowing how to find documentation, check your environment, and use the toolchain makes you dramatically more productive.

---

## 2. Prerequisites

- Go installed on your system (verify with `go version`)
- Basic understanding of what a terminal/command-line is
- Familiarity with file paths and directories
- Understanding of what a package is in Go

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Go toolchain** | The collection of command-line tools bundled with Go |
| **`go` command** | The main tool for all Go operations |
| **GOPATH** | The workspace directory for Go projects (older projects) |
| **GOROOT** | The directory where Go is installed |
| **GOOS** | The target operating system (e.g., "linux", "windows") |
| **GOARCH** | The target CPU architecture (e.g., "amd64", "arm64") |
| **Module** | A collection of related Go packages, defined by `go.mod` |
| **Package** | A directory of `.go` files that belong together |
| **doc comment** | A comment directly above a function/type/package that serves as documentation |
| **pkg.go.dev** | The official website for Go package documentation |
| **godoc** | A tool that generates HTML documentation from Go source code |

---

## 4. Core Commands

### 4.1 `go version` — Check Your Go Version

```bash
go version
# Output: go version go1.21.0 darwin/amd64

# Check what version built a binary
go version ./myprogram
# Output: ./myprogram: go1.21.0
```

**When to use:** Always check this first when setting up a new machine or debugging unexpected behavior.

### 4.2 `go help` — Get Help

```bash
go help                  # List all available go commands
go help build            # Detailed help for the build command
go help testflag         # All available test flags
go help packages         # How to specify packages
go help importpath       # How import paths work
go help environment      # All environment variables
```

**Tip:** When in doubt, `go help <command>` is your best friend.

### 4.3 `go doc` — Read Documentation

```bash
# Package documentation
go doc fmt
go doc os
go doc net/http

# Specific function
go doc fmt.Println
go doc strings.Contains
go doc os.Open

# Show all exported symbols
go doc -all fmt

# Show the source code
go doc -src fmt.Println

# Built-in functions
go doc builtin
go doc builtin.len
go doc builtin.make
go doc builtin.append

# Interface documentation
go doc io.Reader
go doc io.Writer
```

### 4.4 `go env` — View Environment Variables

```bash
go env                   # Show ALL Go environment variables
go env GOPATH            # Show just GOPATH
go env GOROOT            # Show where Go is installed
go env GOOS              # Operating system
go env GOARCH            # CPU architecture
go env GOMODCACHE        # Where downloaded modules are cached
go env -json             # Output in JSON format
```

### 4.5 `go run` — Compile and Run

```bash
go run main.go           # Run a single file
go run .                 # Run current directory's package
go run ./cmd/server      # Run a specific subdirectory
```

### 4.6 `go build` — Compile to Binary

```bash
go build .               # Compile current package to binary
go build -o myapp .      # Name the output binary "myapp"
go build ./...           # Compile all packages (check for errors)
```

### 4.7 `go fmt` — Format Code

```bash
go fmt ./...             # Format all Go files in project
gofmt -w main.go         # Format a specific file and write back
gofmt -d main.go         # Show diff without writing
```

### 4.8 `go vet` — Static Analysis

```bash
go vet ./...             # Check all packages for common errors
```

### 4.9 `go list` — List Packages

```bash
go list ./...            # List all packages in current module
go list -m all           # List all module dependencies
go list -json .          # Detailed JSON info about current package
```

---

## 5. Real-World Analogies

**`go doc` is your dictionary:** Just as you look up word definitions in a dictionary, `go doc` lets you look up what any function, type, or package does — without leaving your terminal.

**`go fmt` is spell-check:** Like a word processor's spell-check automatically fixes spelling, `go fmt` automatically formats your code to Go's standard style. You don't debate formatting — you just run it.

**`go vet` is a grammar checker:** After spell-check (formatting), a grammar checker catches logical problems. `go vet` catches common code mistakes like misused `Printf` format strings.

**`go env` is your system settings panel:** It shows all the "settings" that control how Go behaves on your machine.

---

## 6. Mental Models

**The Go Toolchain is Batteries Included:**
Unlike many languages where you need separate tools for testing, formatting, documentation, etc., Go includes all these in one `go` command. This reduces configuration and ensures consistency.

**Documentation Lives in Source Code:**
Go's philosophy is that documentation should live next to the code it documents. `go doc` reads your source code's comments — there's no separate documentation database to maintain.

**Standard Formatting:**
Go has one official code style. `go fmt` enforces it. There are no debates about tabs vs spaces — tabs win, always, and `go fmt` handles it automatically.

---

## 7. Pros and Cons

### Pros
- All tools are built into the `go` command — no external toolchain needed
- `go doc` works offline — reads your local source
- `go fmt` eliminates style debates in teams
- `go vet` catches bugs before runtime
- Consistent across all platforms (Windows, Mac, Linux)

### Cons
- `go doc` terminal output is less readable than a web browser
- `godoc -http` must be run separately for a web interface
- `go vet` finds only a subset of possible issues (not as powerful as some linters)

---

## 8. Use Cases

| Situation | Command |
|-----------|---------|
| "What does `strings.Contains` do?" | `go doc strings.Contains` |
| "What functions does the `os` package have?" | `go doc -all os` |
| "My code looks messy, fix it" | `go fmt ./...` |
| "Does my code have obvious mistakes?" | `go vet ./...` |
| "What Go version am I using?" | `go version` |
| "Where is my GOPATH?" | `go env GOPATH` |
| "List all my project's dependencies" | `go list -m all` |
| "I want local HTML docs" | `godoc -http=:6060` |

---

## 9. Code Examples

### Example 1: Using `go doc` in Practice

```bash
# Scenario: You want to format a float but don't remember Sprintf syntax
go doc fmt.Sprintf
# Output:
# func Sprintf(format string, a ...any) string
# Sprintf formats according to a format specifier and returns the resulting string.

# Now check the verbs:
go doc fmt
# Shows full package overview including format verbs table
```

### Example 2: Writing Documentation Comments

```go
// Package greeter provides personalized greeting functions.
// It supports multiple languages and greeting styles.
package greeter

// Greet returns a greeting string for the given name.
// The name parameter should be non-empty.
//
// Example:
//
//	g := Greet("Alice")
//	fmt.Println(g) // Hello, Alice!
func Greet(name string) string {
    if name == "" {
        return "Hello, stranger!"
    }
    return "Hello, " + name + "!"
}

// Greeter defines the interface for all greeting implementations.
type Greeter interface {
    // Greet returns a personalized greeting message.
    Greet(name string) string
}
```

After writing this, anyone can run:
```bash
go doc greeter
go doc greeter.Greet
go doc greeter.Greeter
```

### Example 3: `go env` for Cross-Compilation

```bash
# See current target platform
go env GOOS GOARCH
# darwin amd64

# Build for Linux from macOS
GOOS=linux GOARCH=amd64 go build -o myapp-linux .

# Build for Windows
GOOS=windows GOARCH=amd64 go build -o myapp.exe .
```

### Example 4: `go list` to Understand Your Project

```bash
# List all packages in your module
go list ./...
# Output:
# github.com/you/myapp
# github.com/you/myapp/internal/auth
# github.com/you/myapp/internal/db
# github.com/you/myapp/cmd/server

# List all external dependencies
go list -m all
# Output:
# github.com/you/myapp
# github.com/gin-gonic/gin v1.9.1
```

---

## 10. Coding Patterns

### Pattern 1: Write Doc Comments First
```go
// Add returns the sum of a and b.
// Both parameters can be any integer value.
func Add(a, b int) int {
    return a + b
}
```

Write the comment before the function signature — it forces you to think about the API.

### Pattern 2: Use Examples in Documentation
```go
// Divide returns a/b. Returns an error if b is zero.
//
// Example:
//
//	result, err := Divide(10, 2)
//	if err != nil {
//	    log.Fatal(err)
//	}
//	fmt.Println(result) // 5
func Divide(a, b int) (int, error) {
    if b == 0 {
        return 0, fmt.Errorf("division by zero")
    }
    return a / b, nil
}
```

### Pattern 3: Package-Level Doc Comment
```go
// Package cache provides an in-memory cache with TTL support.
//
// Basic usage:
//
//	c := cache.New(5 * time.Minute)
//	c.Set("key", "value")
//	val, ok := c.Get("key")
package cache
```

---

## 11. Clean Code

- **Write doc comments for every exported function, type, and constant**
- Start doc comments with the symbol name: `// Greet returns...`, not `// This function returns...`
- Use blank lines in doc comments to create paragraphs
- Include examples in doc comments using the `Example:` heading
- Run `go fmt ./...` before committing code
- Run `go vet ./...` as part of your CI/CD pipeline

---

## 12. Product Use / Feature Context

In real teams and projects:
- **CI/CD:** `go vet ./...` and `go build ./...` run on every pull request
- **Code reviews:** `go fmt` ensures reviewers see consistent code, not style noise
- **Onboarding:** New team members use `go doc` to understand APIs without reading full source
- **Cross-compilation:** `GOOS=linux go build` is used to build Linux binaries from a Mac developer machine

---

## 13. Error Handling

```bash
# go vet catches errors like:
# bad.go contains: fmt.Printf("%d", "hello")
go vet bad.go
# Output: bad.go:4:2: Printf format %d has arg "hello" of wrong type string

# go build shows compile errors
go build ./...
# Output: ./main.go:10:5: undefined: notAFunction
```

`go build ./...` catches compile errors across your entire project at once.

---

## 14. Security Considerations

- `go vet` catches some security-relevant issues
- Keep `go version` up to date — new versions fix security vulnerabilities
- Use `go list -m all` to audit dependencies for known vulnerabilities
- Run `go env GONOSUMCHECK` to verify checksum settings are appropriate

---

## 15. Performance Tips

- `go build ./...` — build everything to check for errors (fast, no output on success)
- `go build -v ./...` — verbose, shows which packages are being compiled
- `go build -gcflags='-m'` — shows compiler optimization decisions (escape analysis)
- `go vet` is very fast — no excuse not to run it constantly

---

## 16. Metrics & Analytics

- `go list -json .` shows detailed info including build time dependencies
- `go build -work` shows the temporary directory used during compilation

---

## 17. Best Practices

1. **Run `go fmt ./...` before every commit** — or configure your editor to run it on save
2. **Run `go vet ./...` in CI** — it catches real bugs
3. **Write doc comments for all exported symbols** — they appear in `go doc` and pkg.go.dev
4. **Use `go doc` before asking your team** — the answer is often right there
5. **Keep `go.mod` up to date** — use `go mod tidy` regularly
6. **Pin Go version in CI** — use the exact version specified in your `go.mod`

---

## 18. Edge Cases and Pitfalls

```bash
# Pitfall 1: go fmt changes tabs in indentation but spaces in alignment
# This is correct — don't fight it

# Pitfall 2: go vet does not catch all bugs
# It's a fast subset. For more analysis, use staticcheck or golangci-lint

# Pitfall 3: go doc requires package to compile
# If your code has syntax errors, go doc won't work
# go doc mypackage → error reading docs for ...

# Pitfall 4: GOPATH is not relevant for module-based projects
# (Go 1.11+) — don't worry about GOPATH for new projects
```

---

## 19. Common Mistakes

| Mistake | Better Approach |
|---------|----------------|
| Not writing doc comments | Write `// FuncName does X` above every exported symbol |
| Ignoring `go vet` warnings | Fix them — they indicate real bugs |
| Manually formatting code | Run `go fmt ./...` or enable format-on-save in editor |
| Using `go doc` only for stdlib | It works for your own packages too! |
| Running `go build main.go` for multi-file package | Use `go build .` instead |

---

## 20. Common Misconceptions

**Misconception 1:** "`go fmt` is optional"
Reality: Go culture treats formatted code as a requirement. Code reviews reject unformatted code. Most editors run `go fmt` on save automatically.

**Misconception 2:** "I need to install godoc separately"
Reality: `go doc` is built in. `godoc` (the web server) is a separate optional tool.

**Misconception 3:** "`go vet` is the same as `go test`"
Reality: `go vet` performs static analysis WITHOUT running your code. `go test` compiles and executes tests.

---

## 21. Tricky Points

```bash
# Tricky 1: go doc on a local package requires being in the module
cd /path/to/your/project
go doc ./internal/auth  # This works from within the module

# Tricky 2: go doc shows unexported symbols with -u flag
go doc -u fmt.buffer  # Shows unexported 'buffer' type

# Tricky 3: go env can be SET permanently
go env -w GOPATH=/new/path  # Permanently sets GOPATH
go env -u GOPATH            # Resets to default

# Tricky 4: gofmt vs go fmt
# gofmt: operates on files, more options (-r for rewriting rules)
# go fmt: wrapper around gofmt that operates on packages
```

---

## 22. Test (Quiz)

**Q1.** What command shows you the documentation for `strings.Replace`?
- a) `go help strings.Replace`
- b) `go doc strings.Replace`
- c) `go info strings.Replace`
- d) `go man strings.Replace`

**Answer:** b) `go doc strings.Replace`

**Q2.** How do you format all Go files in your current project?
- a) `go format ./...`
- b) `gofmt .`
- c) `go fmt ./...`
- d) `go style ./...`

**Answer:** c) `go fmt ./...`

**Q3.** What does `go vet ./...` do?
- a) Runs all unit tests
- b) Checks code style
- c) Runs static analysis to find common bugs
- d) Verifies module dependencies

**Answer:** c) Static analysis for common bugs

**Q4.** What does `go env GOROOT` show you?
- a) Where your project's source code is
- b) Where Go is installed on your system
- c) The root of your Go module
- d) The root directory of all Go modules

**Answer:** b) Where Go is installed on your system

**Q5.** Which comment style will be picked up by `go doc`?
- a) `/* This is a function */`
- b) `// FunctionName does X` (immediately before the declaration)
- c) `//! Important function`
- d) `# Function description`

**Answer:** b) `// FunctionName does X` — immediately before the declaration, starting with the symbol name

---

## 23. Tricky Questions

**Q: What's the difference between `go doc fmt` and `go help fmt`?**

`go doc fmt` shows the documentation for the **fmt package** (exported functions, types, constants). `go help fmt` would fail — `go help` only works for go toolchain subcommands like `go help build`, `go help test`.

**Q: Why does `go doc` start its output with the package statement?**

The first comment in a file that immediately precedes `package <name>` is the package doc comment. It describes the overall purpose of the package. `go doc` always shows this first.

---

## 24. Cheat Sheet

```bash
# DOCUMENTATION
go doc <pkg>              # Package docs
go doc <pkg>.<Symbol>     # Specific function/type/method
go doc -all <pkg>         # All exported symbols
go doc -src <pkg>.<Sym>   # Show source code
go doc builtin            # Built-in functions (len, make, append...)
godoc -http=:6060         # Local web docs at localhost:6060

# ENVIRONMENT
go env                    # All variables
go env GOPATH GOROOT      # Specific variables
go env -json              # JSON format output
go env -w VAR=value       # Set permanently
go env -u VAR             # Reset to default

# BUILD & RUN
go run .                  # Run current package
go run main.go            # Run specific file
go build -o myapp .       # Build with custom name
go build ./...            # Build all (error check)

# FORMAT & VET
go fmt ./...              # Format all files
gofmt -w main.go          # Format single file in-place
gofmt -d main.go          # Show diff without writing
go vet ./...              # Static analysis

# LIST & MODULES
go list ./...             # All packages in module
go list -m all            # All module dependencies
go list -json .           # Detailed JSON package info
go mod tidy               # Clean up go.mod

# HELP
go help                   # All commands
go help <command>         # Specific command help
go help testflag          # Test flags

# VERSION
go version                # Go version installed
go version ./binary       # Version used to build a binary
```

---

## 25. Self-Assessment Checklist

- [ ] I can look up any standard library function with `go doc`
- [ ] I run `go fmt ./...` before committing code
- [ ] I run `go vet ./...` and fix all warnings
- [ ] I write doc comments for my exported functions
- [ ] I know how to check my Go version with `go version`
- [ ] I can find my GOPATH and GOROOT with `go env`
- [ ] I know the difference between `go run` and `go build`
- [ ] I can list all dependencies with `go list -m all`
- [ ] I understand what pkg.go.dev is and how to use it

---

## 26. Summary

The Go toolchain provides everything a developer needs in one `go` command:
- `go doc` — read documentation for any package or function
- `go help` — learn about any go toolchain command
- `go env` — inspect your Go environment settings
- `go fmt` — automatically format code to Go standard style
- `go vet` — catch common programming mistakes
- `go list` — explore packages and dependencies
- `go build` / `go run` — compile and execute your code
- `pkg.go.dev` — the web-based documentation hub

---

## 27. What You Can Build

After mastering Go commands and documentation:
- Write a well-documented library that generates beautiful pkg.go.dev pages
- Set up a CI pipeline that runs `go vet`, `go fmt`, and `go build` on every commit
- Create a `Makefile` with targets for common Go commands
- Write a shell script that sets up a new Go project with proper tooling
- Use `godoc -http=:6060` to host local documentation for your team

---

## 28. Further Reading

- [Writing doc comments](https://go.dev/blog/godoc)
- [Go commands reference](https://pkg.go.dev/cmd/go)
- [pkg.go.dev](https://pkg.go.dev) — official package docs
- [Go environment variables](https://pkg.go.dev/cmd/go#hdr-Environment_variables)
- [go vet analyzers](https://pkg.go.dev/golang.org/x/tools/go/analysis/passes)

---

## 29. Related Topics

- `go mod` — module management (`go mod init`, `go mod tidy`, `go mod download`)
- `go test` — running unit tests
- `go generate` — code generation with `//go:generate` directives
- `go install` — installing Go binaries
- `golangci-lint` — community meta-linter with many analyzers

---

## 30. Diagrams and Visual Aids

### The Go Toolchain Overview
```
Your Go Source Code (.go files)
         │
         ├─── go fmt ./... ──────→ Formatted code (standard style)
         │
         ├─── go vet ./... ──────→ Static analysis warnings
         │
         ├─── go build -o app . → Binary executable
         │
         ├─── go test ./... ─────→ Test results
         │
         ├─── go doc <pkg> ──────→ Documentation
         │
         └─── go list ./... ─────→ Package/dependency info
```

### `go doc` Information Hierarchy
```
go doc fmt              ← Package overview + list of all exports
   │
   ├─── go doc fmt.Println      ← Specific function signature + docs
   ├─── go doc fmt.Stringer     ← Interface definition + docs
   └─── go doc -all fmt         ← Everything including unexported (with -u)
```

### Documentation Comment Format
```go
// FuncName <verb> <what it does.>          ← Single sentence, symbol first
// Optional additional explanation here.    ← Extra context
//
// Example:
//
//	result := FuncName(arg)                 ← Indented with tab = code block
//	fmt.Println(result)
func FuncName(arg Type) ReturnType {
```

### pkg.go.dev Layout
```
pkg.go.dev/fmt
├── Overview section      ← Package doc comment
├── Index section         ← All exported symbols
├── Constants             ← const blocks
├── Variables             ← var blocks
├── Functions             ← func declarations + docs
├── Types                 ← type declarations
│   └── Methods           ← methods listed under their type
└── Examples              ← runnable in the browser!
```
