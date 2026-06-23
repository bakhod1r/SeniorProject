# Go Commands & Documentation — Interview Q&A

---

## Junior Level Questions

**Q1. How do you check which version of Go is installed on your system?**

**A:** Use `go version`:
```bash
go version
# go version go1.21.0 darwin/amd64
```

---

**Q2. What command do you use to read the documentation for `fmt.Println`?**

**A:** `go doc fmt.Println`
```bash
go doc fmt.Println
# func Println(a ...any) (n int, err error)
# Println formats using the default formats for its operands and writes to
# standard output. Spaces are always added between operands and a newline is
# appended. It returns the number of bytes written and any write error encountered.
```

---

**Q3. How do you format all Go files in a project?**

**A:** `go fmt ./...` — the `./...` pattern means "current directory and all subdirectories recursively".

```bash
go fmt ./...
```

---

**Q4. What does `go vet` do?**

**A:** `go vet` runs static analysis on Go code to find common programming mistakes WITHOUT executing the code. It detects issues like wrong `Printf` format verbs, unreachable code, missing error returns, and misused `sync` primitives.

```bash
go vet ./...
# ./main.go:15:3: Printf call has arguments but no formatting directives
```

---

**Q5. What is `go env` used for?**

**A:** `go env` displays Go environment variables that control how Go behaves. Common uses:
- `go env GOPATH` — find your workspace
- `go env GOROOT` — find Go installation
- `go env GOOS GOARCH` — see target OS and architecture

---

**Q6. What is the correct format for a Go documentation comment?**

**A:** A doc comment is a `//` comment immediately preceding a declaration, starting with the name of the symbol being documented.

```go
// Greet returns a personalized greeting for the given name.
func Greet(name string) string {
    return "Hello, " + name
}
```

Key rules: starts with `//`, immediately before the declaration, first sentence starts with the symbol name.

---

**Q7. How do you list all packages in a Go module?**

**A:** `go list ./...`
```bash
go list ./...
# github.com/myorg/myapp
# github.com/myorg/myapp/internal/auth
# github.com/myorg/myapp/cmd/server
```

---

**Q8. What does `GOOS=linux go build .` do?**

**A:** It cross-compiles the package for Linux, regardless of what OS you're running on. `GOOS` sets the target operating system and `GOARCH` sets the target architecture.

```bash
GOOS=linux GOARCH=amd64 go build -o myapp-linux .
```

---

**Q9. How do you see all exported symbols in a package?**

**A:** Use `go doc -all <package>`:
```bash
go doc -all os
# Shows every exported constant, variable, function, and type in the os package
```

---

**Q10. Where can you find Go package documentation online?**

**A:** At `pkg.go.dev` — the official Go package documentation website. For example:
- `pkg.go.dev/fmt` — fmt package
- `pkg.go.dev/builtin` — built-in functions
- `pkg.go.dev/std` — standard library overview

---

## Middle Level Questions

**Q11. What is the difference between `go doc` and `godoc`?**

**A:**
- `go doc` is a terminal command that shows documentation for a package or symbol in your terminal
- `godoc` is a separate web server that serves HTML documentation at `localhost:6060`

`go doc` is built into the Go toolchain. `godoc` must be installed separately: `go install golang.org/x/tools/cmd/godoc@latest`

```bash
go doc fmt.Println        # terminal output
godoc -http=:6060         # web server at localhost:6060
```

---

**Q12. What does `go list -m all` show?**

**A:** It shows ALL module dependencies (both direct and indirect) of the current module, with their versions. This is everything in `go.sum`.

```bash
go list -m all
# github.com/myorg/myapp
# github.com/gin-gonic/gin v1.9.1
# github.com/gin-contrib/sse v0.1.0 // indirect
```

---

**Q13. What is a `//go:generate` directive and when is it executed?**

**A:** A `//go:generate` directive is a special comment that tells `go generate` what command to run. It is NEVER run automatically — only when you explicitly run `go generate ./...`.

```go
//go:generate stringer -type=Color

type Color int
const (
    Red Color = iota
    Green
    Blue
)
```

```bash
go generate ./...  # executes: stringer -type=Color
```

Generated files are committed to version control.

---

**Q14. What is the difference between `go get` and `go install`?**

**A:**
- `go get <module>@version` — adds or updates a dependency in `go.mod`
- `go install tool@version` — installs a Go binary tool (does NOT modify `go.mod`)

Since Go 1.16, `go install` is the correct way to install tools:
```bash
go install golang.org/x/tools/cmd/godoc@latest
```

---

**Q15. How do you check if all Go files in a project are formatted (without changing them)?**

**A:** Use `gofmt -l .` which lists unformatted files, or check the exit code:

```bash
# List unformatted files
gofmt -l .
# If any output: files need formatting

# Check and fail in CI
if [ "$(gofmt -l .)" != "" ]; then
    echo "Unformatted files:"
    gofmt -l .
    exit 1
fi
```

---

**Q16. What does `go mod tidy` do?**

**A:** `go mod tidy` updates `go.mod` and `go.sum` to reflect the actual imports in the code:
1. Adds missing module requirements
2. Removes module requirements that are no longer needed
3. Updates `go.sum` with hashes for all (including indirect) dependencies

Run it after adding/removing imports or before committing.

---

**Q17. What is a build tag in Go and how do you use it?**

**A:** A build tag (build constraint) controls whether a file is included in a build. They're specified as a special comment:

```go
//go:build linux || darwin

package main

// This code only compiles on Linux or macOS
```

Common uses: platform-specific code, integration test files, generated code.

```bash
go build -tags integration ./...  # include files tagged "integration"
```

---

**Q18. How does `go vet` know about `Printf`-style functions in your own code?**

**A:** You can annotate your functions with `//nolint` or — more correctly — use the `go:generate` approach with `errcheck`. But for `printf`-style functions, you can use the `log/slog` or similar packages that `go vet` understands natively. For custom functions, `go vet` won't check them unless you annotate with `// noCopy` or similar.

For custom Printf-like functions, the standard approach is to document them clearly and use `golangci-lint`'s `nolint` directives or configure `printf` checker.

---

**Q19. What environment variable controls where Go module downloads are cached?**

**A:** `GOMODCACHE` (default: `$GOPATH/pkg/mod`). Use `go env GOMODCACHE` to see its current value.

```bash
go env GOMODCACHE
# /Users/username/go/pkg/mod
```

In CI, this directory should be cached between runs to avoid re-downloading modules.

---

**Q20. How do you view the source code of a standard library function using the command line?**

**A:** Use `go doc -src <package>.<Function>`:

```bash
go doc -src fmt.Println
# func Println(a ...any) (n int, err error) {
#     return Fprintln(os.Stdout, a...)
# }
```

---

## Senior Level Questions

**Q21. How would you verify that `go generate` has been run and generated files are up to date in CI?**

**A:** Run `go generate` in CI and then check if the working directory is clean:

```bash
go generate ./...
git diff --exit-code
```

If `go generate` produces any changes, `git diff --exit-code` returns non-zero, failing CI. This ensures developers always commit up-to-date generated code.

---

**Q22. Explain the difference between GONOSUMDB and GONOSUMCHECK.**

**A:**
- `GONOSUMDB`: Modules matching these patterns are NOT looked up in the checksum database (sum.golang.org), but they ARE still verified against the local `go.sum` if present.
- `GONOSUMCHECK`: Modules matching these patterns skip ALL checksum verification — including the local `go.sum`. This is less secure and should only be used in fully controlled environments.

```bash
# Skip sum.golang.org lookup but keep local go.sum verification:
go env -w GONOSUMDB="*.company.internal"

# Skip ALL checksum verification (dangerous):
go env -w GONOSUMCHECK="*.company.internal"
```

---

**Q23. How do you write runnable examples in Go documentation, and how are they tested?**

**A:** Examples are `func Example*()` functions in `_test.go` files. If they have an `// Output:` comment, they're compiled and run during `go test`, and the output is compared.

```go
// example_test.go
package mypackage_test

import (
    "fmt"
    "mypackage"
)

func ExampleGreet() {
    fmt.Println(mypackage.Greet("Alice"))
    // Output: Hello, Alice!
}
```

```bash
go test -run Example ./...  # runs all Example functions
```

If the actual output doesn't match the `// Output:` comment, the test fails.

---

**Q24. What is the `tools.go` pattern and why is it used?**

**A:** `tools.go` is a convention for pinning tool dependencies in a module:

```go
//go:build tools

package tools

import (
    _ "golang.org/x/tools/cmd/godoc"
    _ "github.com/golang/mock/mockgen"
)
```

The `//go:build tools` tag means this file is never compiled normally. But the imports cause the tools to appear in `go.mod`, allowing `go mod tidy` to manage them. This ensures everyone on the team uses the same tool versions.

---

**Q25. Describe how you would set up a comprehensive CI pipeline for a Go project.**

**A:**

```yaml
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
          cache: true

      - name: Verify modules
        run: go mod verify

      - name: Check format
        run: |
          if [ "$(gofmt -l .)" != "" ]; then
            gofmt -l .
            exit 1
          fi

      - name: Vet
        run: go vet ./...

      - name: Check generated files
        run: |
          go generate ./...
          git diff --exit-code

      - name: Lint
        uses: golangci/golangci-lint-action@v3

      - name: Test
        run: go test -race -coverprofile=coverage.txt ./...

      - name: Build (all platforms)
        run: |
          GOOS=linux GOARCH=amd64 go build ./...
          GOOS=darwin GOARCH=arm64 go build ./...
          GOOS=windows GOARCH=amd64 go build ./...
```

---

**Q26. How does the Go build cache work and how would you troubleshoot cache-related build issues?**

**A:** The build cache stores compiled packages keyed by a hash of source files, compiler flags, Go version, and environment variables. It lives at `$GOCACHE` (default `~/.cache/go-build`).

Troubleshooting:
```bash
# See cache location
go env GOCACHE

# Clear cache and rebuild
go clean -cache
go build ./...

# See what's in the cache
go env GOCACHE | xargs ls

# Verbose build (shows cache hits/misses)
go build -v ./...

# Show build flags that affect caching
go build -x ./...
```

Cache corruption is rare but can happen with filesystem issues or interrupted builds. `go clean -cache` always resolves it.

---

**Q27. What is the `go tool` command and what tools are available?**

**A:** `go tool` runs low-level Go tools that are part of the Go distribution:

```bash
go tool compile     # the Go compiler
go tool link        # the linker
go tool asm         # the assembler
go tool nm          # list symbols in object files
go tool objdump     # disassemble object files
go tool pprof       # analyze performance profiles
go tool trace       # analyze execution traces
go tool cover       # coverage analysis
go tool vet         # static analysis (same as go vet)
go tool dist        # Go distribution tool
go tool api         # Go API compatibility checker

# Examples:
go tool nm myapp | grep main
go tool pprof cpu.prof
go tool cover -html=coverage.txt
```

---

**Q28. How would you use `go list` to find all packages that depend on a specific internal package?**

**A:**

```bash
# Find all packages that import internal/auth
go list -f '{{.ImportPath}}: {{.Imports}}' ./... | \
    grep "internal/auth"

# More precise with JSON:
go list -json ./... | \
    python3 -c "
import json, sys
data = json.load(sys.stdin)
for pkg in (data if isinstance(data, list) else [data]):
    if 'github.com/myorg/myapp/internal/auth' in pkg.get('Imports', []):
        print(pkg['ImportPath'])
"

# Or using jq:
go list -json ./... | jq -r 'select(.Imports[]? == "github.com/myorg/myapp/internal/auth") | .ImportPath'
```

---

**Q29. Explain `go mod graph` and how you'd use it to debug a dependency conflict.**

**A:** `go mod graph` prints the module dependency graph (all edges, showing which module requires which other module).

```bash
go mod graph
# github.com/myapp github.com/gin-gonic/gin@v1.9.1
# github.com/gin-gonic/gin@v1.9.1 github.com/go-playground/validator/v10@v10.14.0
# ...

# Find why a specific version is required:
go mod why github.com/conflicted/pkg

# List all versions in graph for a module:
go mod graph | grep "conflicted/pkg"

# Use go mod graph with mvs (minimum version selection) to understand versions:
go list -m -json all | jq -r 'select(.Path == "conflicted/pkg") | .Version'
```

If there's a version conflict:
```bash
# Force a specific version
go get conflicted/pkg@v1.2.3

# Or use replace directive in go.mod:
# replace github.com/conflicted/pkg => github.com/myfork/pkg v1.2.3-fixed
```

---

**Q30. How would you use Go tooling to find security vulnerabilities in your dependencies?**

**A:**

```bash
# Install govulncheck (official Go vulnerability scanner)
go install golang.org/x/vuln/cmd/govulncheck@latest

# Scan your module
govulncheck ./...

# Output example:
# Vulnerability #1: GO-2023-1234
# github.com/vulnerable/package before v1.2.3
# Found in: github.com/vulnerable/package@v1.2.1
# Fixed in: github.com/vulnerable/package@v1.2.3
# ...

# Integrate in CI:
govulncheck ./... 2>&1 | tee vuln-report.txt
if grep -q "Vulnerability" vuln-report.txt; then
    echo "Vulnerabilities found!"
    exit 1
fi
```

Also useful:
```bash
# List all direct dependencies (for manual audit)
go list -m -f '{{if not .Indirect}}{{.}}{{end}}' all

# Check for outdated dependencies
go list -m -u all  # shows available updates
```

---

## Scenario-Based Questions

**Q31. A new team member asks: "Why do I have to run `go fmt` before committing? Can't I use my own style?" How do you respond?**

**A:** Go's standard formatter is a team feature, not a personal preference:
1. **No style debates in code review** — all style questions are settled by `go fmt`
2. **Consistent codebase** — any Go developer can read any Go code without style adjustment
3. **Clean diffs** — no noise from formatting changes in pull requests
4. **Industry standard** — the entire Go ecosystem uses `gofmt` style; third-party code is always formatted the same way

Configure your editor to run `go fmt` on save, and you'll never have to think about it.

---

**Q32. A team's CI is very slow. How would you use Go tooling to speed it up?**

**A:**
1. **Cache `GOMODCACHE` and `GOCACHE`** between CI runs — biggest win
2. **Run `go test -count=1` instead of `go clean -testcache`** — avoids re-running cached tests unless needed
3. **Use `-parallel` flag** — `go test -parallel=8 ./...`
4. **Separate fast and slow tests** — use `//go:build integration` tags for slow tests
5. **Only run affected packages** — with monorepos, use `go list` to find changed packages
6. **Cache Docker layers** — if building in Docker, separate `go mod download` from compilation

---

**Q33. You're building a library. How do you ensure its documentation is high quality?**

**A:**
1. **Doc comments for every exported symbol** — function, type, constant, variable
2. **Run `go doc` and review it** — if it looks wrong in terminal, it looks wrong on pkg.go.dev
3. **Write example functions** — `ExampleFoo()` in `_test.go` — these run as tests
4. **Include a package overview** — extensive package-level comment with usage examples
5. **Use `go doc -all .`** — review the complete public API view
6. **Document error conditions** — what errors can each function return?
7. **Document panics** — which functions can panic and under what conditions?
8. **Use `godoc -http=:6060`** — preview the HTML documentation

---

## FAQ

**FAQ1. Should I commit the `vendor/` directory?**

It depends on your policy:
- **Commit vendor/**: guarantees reproducibility even if proxies are unavailable; simpler offline builds; larger repository
- **Don't commit vendor/**: smaller repository; rely on module proxy; run `go mod download` in CI

Most modern teams use module proxies and don't commit vendor.

**FAQ2. What's the difference between `go build ./...` and `go build .`?**

- `go build .` builds only the current package
- `go build ./...` builds ALL packages in the module (recursively). Used to check for compile errors everywhere without building individual binaries.

**FAQ3. How often should I run `go mod tidy`?**

After any change to imports: adding a new import, removing an import, or upgrading a dependency. Also run it before creating a pull request. Some teams run it automatically via a pre-commit hook.

**FAQ4. What's the `all` pattern in `go list -m all`?**

`all` refers to all packages reachable from the packages in the current module. In module-aware mode, `go list -m all` shows the full module graph — direct and all transitive dependencies.

**FAQ5. Can I use `go vet` to check only specific things?**

Yes, use `-<check>=false` to disable specific checks or only run specific ones:
```bash
go vet -printf=false ./...   # disable printf check
go vet -printf ./...         # enable only printf check (others disabled)
```

For fine-grained control, use `golangci-lint` which is fully configurable via `.golangci.yml`.
