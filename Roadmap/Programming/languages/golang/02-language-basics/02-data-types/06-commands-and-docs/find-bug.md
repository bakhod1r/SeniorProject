# Go Commands & Documentation — Find the Bug

Each section presents a scenario with a hidden issue. Try to find it before opening the hint/solution.

---

## Bug 1 🟢 — Wrong Doc Comment Format

```go
package calculator

// This function adds two numbers together and returns their sum.
// It can handle both positive and negative integers.
func add(a, b int) int {
    return a + b
}

// The exported version of add.
func Add(a, b int) int {
    return a + b
}
```

Running `go doc calculator.Add` shows nothing useful.

<details>
<summary>Hint</summary>
What is the rule for doc comments? Should they start with any specific text? Is the `add` function exported?
</details>

<details>
<summary>Solution</summary>

**Bugs:**
1. `add` (lowercase) is unexported — it won't appear in `go doc` at all, but the doc comment format is still wrong
2. `Add` (uppercase) has a doc comment that doesn't follow the convention: it should start with the function name: `// Add returns the sum of a and b.`

**Fix:**
```go
package calculator

// add returns the sum of a and b.
func add(a, b int) int {
    return a + b
}

// Add returns the sum of a and b.
// Both positive and negative integers are supported.
func Add(a, b int) int {
    return a + b
}
```

**Rule:** Doc comments for exported symbols must start with the symbol's name. `go doc` uses this convention to identify what is being described. IDEs and pkg.go.dev display this as the first sentence.
</details>

---

## Bug 2 🟢 — Build Tag Syntax Error

```go
// +build linux
//go:build linux

package main

import "fmt"

func main() {
    fmt.Println("Linux only!")
}
```

This file never compiles on Linux.

<details>
<summary>Hint</summary>
What is the required order of build constraint comments relative to the package statement? Is there something between the build tag and `package`?
</details>

<details>
<summary>Solution</summary>

**Bug:** The build constraints must be followed by a blank line before the `package` statement. Without the blank line, Go does not recognize them as build constraints.

Additionally, in modern Go (1.17+), the `//go:build` line should come BEFORE the `// +build` line (for backward compatibility).

**Fix:**
```go
//go:build linux
// +build linux

package main

import "fmt"

func main() {
    fmt.Println("Linux only!")
}
```

The blank line between the build tag block and `package` is mandatory. Without it, the tag is treated as a regular comment.
</details>

---

## Bug 3 🟢 — go generate Directive in Wrong Place

```go
package main

import "fmt"

// Direction represents a compass direction.
type Direction int

// go:generate stringer -type=Direction
const (
    North Direction = iota
    South
    East
    West
)

func main() {
    fmt.Println(North)
}
```

Running `go generate ./...` does nothing.

<details>
<summary>Hint</summary>
The `//go:generate` directive has a specific format. Look carefully at the comment.
</details>

<details>
<summary>Solution</summary>

**Bug:** The generate directive is `// go:generate` (with a space between `//` and `go`). It should be `//go:generate` (no space).

Go only recognizes `//go:generate` (no space) as a generate directive. `// go:generate` is a regular comment.

**Fix:**
```go
package main

import "fmt"

// Direction represents a compass direction.
//go:generate stringer -type=Direction
type Direction int

const (
    North Direction = iota
    South
    East
    West
)

func main() {
    fmt.Println(North)
}
```

Note: The `//go:generate` directive should be placed directly before the type declaration it generates for, not after it.
</details>

---

## Bug 4 🟢 — Ignoring go vet Warnings

```go
package main

import "fmt"

func printUserInfo(name string, age int) {
    fmt.Printf("User: %s, Age: %d", name)  // forgot to pass age
}

func main() {
    printUserInfo("Alice", 30)
}
```

The code compiles but the output is missing age.

<details>
<summary>Hint</summary>
Run `go vet ./...` on this code. What does it report?
</details>

<details>
<summary>Solution</summary>

**Bug:** `fmt.Printf` format string has `%d` but the corresponding argument `age` is not passed. The output would be: `User: Alice, Age: %!d(MISSING)`.

`go vet` would catch this:
```
./main.go:6:2: Printf call needs 2 args but has 1 args
```

**Fix:**
```go
func printUserInfo(name string, age int) {
    fmt.Printf("User: %s, Age: %d", name, age)  // pass age
}
```

**Lesson:** Always run `go vet ./...` and take its warnings seriously. This is exactly the class of bug it's designed to catch.
</details>

---

## Bug 5 🟡 — GOPROXY Causing Silent Failures

**Scenario:** A developer sets up a new machine and clones the company's private repo. When running `go build`, they get:

```
go: github.com/company/private-module@v1.2.3: 
    reading https://proxy.golang.org/github.com/company/private-module/@v/v1.2.3.info: 
    410 Gone
```

<details>
<summary>Hint</summary>
What does `go env GOPROXY` show? Why would the public proxy return 410 for a private module?
</details>

<details>
<summary>Solution</summary>

**Bug:** The `GOPROXY` is set to `https://proxy.golang.org,direct` (default). The public proxy doesn't have access to private company modules and returns 410 (Gone) instead of trying `direct` in some cases.

**Fix:**
```bash
# Option 1: Use GONOSUMDB to bypass the public proxy for private modules
go env -w GONOSUMDB="github.com/company/*"
go env -w GONOSUMCHECK="github.com/company/*"

# Option 2: Use GOPRIVATE (sets both GONOSUMDB and GONOSUMCHECK)
go env -w GOPRIVATE="github.com/company/*"

# Option 3: Use a corporate proxy that has access
go env -w GOPROXY="https://corp-proxy.company.com,direct"

# Option 4: Bypass proxy entirely for this domain
go env -w GOPROXY="direct"  # not recommended for all packages
```

**Explanation:** `GOPRIVATE` is a shorthand that sets both `GONOSUMDB` and `GONOSUMCHECK` for the matching module patterns, preventing the public checksum database and proxy from being consulted.
</details>

---

## Bug 6 🟡 — go generate Not Committed

```bash
# .gitignore
*_string.go  # generated by stringer
*.pb.go      # generated by protoc
mock_*.go    # generated by mockgen
```

The CI pipeline keeps failing with errors about missing types.

<details>
<summary>Hint</summary>
What is the Go philosophy about generated files? Should they be committed or regenerated on each build?
</details>

<details>
<summary>Solution</summary>

**Bug:** Generated files should NOT be in `.gitignore`. In Go's workflow:
1. Developers run `go generate ./...` locally
2. Generated files are committed to version control
3. CI builds use the committed generated files WITHOUT running `go generate`

This ensures:
- Reproducible builds (no need for generators in CI)
- Version-controlled generated code (visible in diffs)
- Faster CI (no generator installation needed)

**Fix:**
```bash
# Remove generated files from .gitignore
# Instead, in CI, verify that generated files are up to date:
go generate ./...
git diff --exit-code  # fail if any generated file changed
```

```
# .gitignore — only ignore real build artifacts
/bin/
/dist/
*.test
coverage.txt
```

**Alternative:** If generated files are large and change frequently, some teams DO use the "regenerate in CI" approach. But then CI must have all generators installed, which adds complexity.
</details>

---

## Bug 7 🟡 — Missing Error Check After go build

```bash
#!/bin/bash
# deploy.sh

echo "Building..."
go build -o /tmp/myapp ./cmd/server

echo "Deploying..."
scp /tmp/myapp server:/usr/local/bin/myapp
ssh server "systemctl restart myapp"
echo "Done!"
```

The deployment script sometimes deploys the OLD binary even when the build fails.

<details>
<summary>Hint</summary>
What does `go build` do with the output file when compilation fails? Does it overwrite the existing file?
</details>

<details>
<summary>Solution</summary>

**Bug:** When `go build` fails:
1. It exits with a non-zero code
2. It does NOT create/update the output file `-o /tmp/myapp`

However, the bash script doesn't check the exit code! If `/tmp/myapp` already exists from a previous successful build, it proceeds with the old binary.

**Fix:**
```bash
#!/bin/bash
set -e  # Exit immediately on any error

echo "Building..."
if ! go build -o /tmp/myapp ./cmd/server; then
    echo "Build FAILED! Aborting deployment."
    exit 1
fi

echo "Deploying..."
scp /tmp/myapp server:/usr/local/bin/myapp
ssh server "systemctl restart myapp"
echo "Done!"
```

`set -e` at the top makes the script exit on any non-zero exit code. The explicit `if !` check provides a better error message.
</details>

---

## Bug 8 🟡 — Wrong go doc Package Path

```bash
# Developer is in ~/projects/myapp
# They want to see docs for their internal package

go doc internal/auth

# Error: no such package: internal/auth
```

<details>
<summary>Hint</summary>
What is the difference between a file path and an import path? How should you reference your own module's packages?
</details>

<details>
<summary>Solution</summary>

**Bug:** `go doc` accepts import paths, not filesystem paths. The correct way to reference internal packages uses either:
1. The full import path: `github.com/myorg/myapp/internal/auth`
2. The relative package path: `./internal/auth`

```bash
# Option 1: Full import path
go doc github.com/myorg/myapp/internal/auth

# Option 2: Relative path (must be in the module root)
go doc ./internal/auth

# Option 3: List packages first to find the right path
go list ./...
# github.com/myorg/myapp/internal/auth
# Then:
go doc github.com/myorg/myapp/internal/auth
```

Note: `internal/auth` (without `./`) is interpreted as a top-level package path, not a local package.
</details>

---

## Bug 9 🔴 — Vendoring Causes Build Inconsistency

```
project/
├── vendor/
│   └── github.com/dep/package/
│       └── (files from 3 months ago)
├── go.mod (specifies dep v2.0.0)
├── go.sum
└── main.go
```

The CI builds pass with the vendored version, but a developer's local build uses a different version.

<details>
<summary>Hint</summary>
How does Go decide whether to use the `vendor/` directory or the module cache? What command would help you understand this?
</details>

<details>
<summary>Solution</summary>

**Bug:** The vendor directory is out of sync with `go.mod`. This happens when:
1. `go.mod` was updated (e.g., `go get dep@v2.0.0`) without running `go mod vendor`
2. Or `vendor/` was manually modified
3. Developers without the vendor flag use the module cache (different version!)

**Investigation:**
```bash
# Check if vendor is in sync
go mod verify

# See what module versions are actually vendored
cat vendor/modules.txt  # shows what versions are vendored

# Check for discrepancy
go list -m dep/package   # go.mod version
cat vendor/modules.txt | grep dep/package  # vendored version
```

**Fix:**
```bash
# Regenerate vendor from go.mod
go mod vendor

# Verify it's correct
go mod verify

# Commit the updated vendor directory
git add vendor/
git commit -m "update vendor directory to match go.mod"
```

**Prevention:**
```bash
# In CI, always build with -mod=vendor when vendor/ exists
go build -mod=vendor ./...

# Or add to GOFLAGS:
go env -w GOFLAGS="-mod=vendor"
```
</details>

---

## Bug 10 🔴 — go:generate Breaks Cross-Platform CI

```go
//go:generate bash -c "echo 'package main\nvar Generated = true' > generated.go"
```

This works on the developer's Mac but fails on the Linux CI runner.

<details>
<summary>Hint</summary>
Is `bash` guaranteed to be available? Is the `-c` flag's behavior with newlines consistent across shells? What's the recommended approach?
</details>

<details>
<summary>Solution</summary>

**Bug:** The `bash` command and specific `echo` behavior (`\n` as newline) are platform-dependent:
- On macOS: `bash -c "echo 'x\ny'"` may or may not interpret `\n` depending on the shell
- On Alpine Linux CI: `bash` might not be installed, or `echo` may not support `-e`
- Windows: `bash` definitely isn't available by default

**Fix:**
```go
// Option 1: Use a Go program as the generator
//go:generate go run ./cmd/generate

// Option 2: Write a standalone Go generator
//go:generate go run gen.go

// gen.go (with //go:build ignore to exclude from normal build)
//go:build ignore

package main

import "os"

func main() {
    content := []byte("package main\nvar Generated = true\n")
    os.WriteFile("generated.go", content, 0644)
}
```

```go
// Option 3: Use cross-platform tool like stringer, protoc, or go-bindata
//go:generate stringer -type=MyEnum
```

**Principle:** `go:generate` commands should use Go programs (cross-platform) rather than shell commands (platform-specific). If you must use shell, document the requirements clearly and check in CI.
</details>

---

## Bug 11 🔴 — Documentation Example Has Wrong Output Comment

```go
// ExampleFormatBytes shows how to format byte sizes as human-readable strings.
func ExampleFormatBytes() {
    sizes := []int64{1024, 1048576, 1073741824}
    for _, s := range sizes {
        fmt.Println(FormatBytes(s))
    }
    // Output:
    // 1KB
    // 1MB
    // 1GB
}
```

`go test ./...` passes locally but fails in CI.

<details>
<summary>Hint</summary>
What environment-specific factors could cause `FormatBytes` to produce different output? Think about the output comment — is it exactly right?
</details>

<details>
<summary>Solution</summary>

**Bug:** The `// Output:` comment must match the actual output EXACTLY, including:
- Whitespace
- Case
- Line endings

If `FormatBytes` produces `1 KB` (with space) instead of `1KB` (no space), the test fails. Alternatively, if CI runs on a different OS where float formatting differs, it can fail.

**Investigation:**
```bash
go test -v -run ExampleFormatBytes ./...
# --- FAIL: ExampleFormatBytes (0.00s)
# got:
# 1 KB
# 1 MB
# 1 GB
# want:
# 1KB
# 1MB
# 1GB
```

**Fix — Option 1:** Update the output comment to match actual output:
```go
// Output:
// 1 KB
// 1 MB
// 1 GB
```

**Fix — Option 2:** Make the function deterministic:
```go
func FormatBytes(n int64) string {
    // Ensure consistent output regardless of locale
    switch {
    case n >= 1073741824:
        return fmt.Sprintf("%.0fGB", float64(n)/1073741824)
    case n >= 1048576:
        return fmt.Sprintf("%.0fMB", float64(n)/1048576)
    default:
        return fmt.Sprintf("%.0fKB", float64(n)/1024)
    }
}
```

**Lesson:** Example functions are tests. Run `go test ./...` every time you write or modify an example.
</details>

---

## Bug 12 🔴 — Build Cache Causes Stale Binary in Production

```bash
#!/bin/bash
# build-release.sh

export GOFLAGS="-ldflags=-X main.Version=$1"
go build -o release/myapp ./cmd/server
echo "Version $1 built"
```

The release binary keeps showing an old version even though `$1` changes.

<details>
<summary>Hint</summary>
How does the build cache determine whether to recompile? Does changing a build flag invalidate the cache?
</details>

<details>
<summary>Solution</summary>

**Bug:** Build flags ARE included in the cache key. However, `-ldflags` only affects the LINKER step, not the compiler. The object files may be cached and reused even when the ldflags change. But there's another issue: `GOFLAGS` in the environment may not always be picked up correctly, or the version variable might not be linked.

The real issue is often this: the `-X main.Version` syntax requires the variable to exist and be a `var`, not a `const`:

```go
// WRONG — constants can't be set by ldflags
const Version = "dev"

// CORRECT — var can be set by ldflags
var Version = "dev"
```

**Also:** Ensure the ldflags syntax is correct:
```bash
# CORRECT syntax:
go build -ldflags="-X 'main.Version=$VERSION'" ./cmd/server

# If the package is not main but another package:
go build -ldflags="-X 'github.com/org/app/pkg/version.Version=$VERSION'" .
```

**Verification:**
```bash
# Check the version is embedded correctly
./release/myapp --version
# or:
go version -m ./release/myapp | grep main.Version
```

**Fix:**
```bash
#!/bin/bash
set -e

VERSION="${1:-dev}"
COMMIT=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

go build \
    -ldflags="-X 'main.Version=${VERSION}' -X 'main.Commit=${COMMIT}' -X 'main.BuildTime=${BUILD_TIME}'" \
    -o release/myapp \
    ./cmd/server

echo "Built version ${VERSION} (${COMMIT})"
```
</details>

---

## Bug 13 🔴 — go mod tidy Removes Needed Indirect Dependencies

```go
// tools.go
//go:build tools

package tools

import (
    _ "github.com/golang/mock/mockgen"  // used by go generate
)
```

After running `go mod tidy`, mockgen's dependencies are removed from `go.mod`, breaking `go generate`.

<details>
<summary>Hint</summary>
Why would `go mod tidy` remove a dependency? What does it consider "used"? Is `tools.go` included in the normal build?
</details>

<details>
<summary>Solution</summary>

**Bug:** `go mod tidy` removes dependencies that aren't imported by the code that will actually be compiled. The `//go:build tools` constraint means `tools.go` is NEVER compiled, so `go mod tidy` considers its imports unused and removes them.

**Fix:**
```bash
# Run go mod tidy, then immediately re-add the tools
go mod tidy
go get github.com/golang/mock/mockgen@v1.6.0
```

OR, better: Use the `tools.go` pattern correctly. The `tools.go` file needs to use a build tag that `go mod tidy` still considers when building for the current platform:

```go
// tools.go
//go:build tools

package tools

// Import tools so go.mod tracks their versions.
// These imports keep the tool dependencies in go.sum
// even though they're not imported in production code.
import (
    _ "github.com/golang/mock/mockgen"
    _ "honnef.co/go/tools/cmd/staticcheck"
    _ "golang.org/x/tools/cmd/stringer"
)
```

Actually `go mod tidy` DOES include `//go:build tools` files in its analysis (it considers all build constraints). The issue might be something else:

The real fix is to always run:
```bash
go mod tidy && go generate ./... && go mod tidy
```

Or pin tools with explicit `go get`:
```bash
go get github.com/golang/mock/mockgen@v1.6.0
```

And add a `go mod verify` step in CI to catch this before deployment.
</details>

---

## Summary Table

| # | Difficulty | Bug Type |
|---|-----------|----------|
| 1 | 🟢 | Wrong doc comment format (doesn't start with symbol name) |
| 2 | 🟢 | Missing blank line after build tag |
| 3 | 🟢 | Space in `// go:generate` (should be `//go:generate`) |
| 4 | 🟢 | Ignored `go vet` warning for Printf format mismatch |
| 5 | 🟡 | GOPROXY blocking private module access |
| 6 | 🟡 | Generated files in .gitignore (should be committed) |
| 7 | 🟡 | Missing error check after `go build` in deploy script |
| 8 | 🟡 | Wrong package path format for `go doc` |
| 9 | 🔴 | Vendor directory out of sync with go.mod |
| 10 | 🔴 | Shell-dependent go:generate breaks on different platforms |
| 11 | 🔴 | Example `// Output:` comment doesn't match actual output |
| 12 | 🔴 | ldflags not embedded in variable (const instead of var) |
| 13 | 🔴 | go mod tidy removes tool dependencies |
