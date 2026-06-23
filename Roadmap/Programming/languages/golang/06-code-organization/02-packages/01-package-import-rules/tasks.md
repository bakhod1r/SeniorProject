# Package Import Rules — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Hello, fmt

Create a fresh directory `hello-import`. Initialise it as a module with the path `example.com/hello-import`. Inside `main.go`, import the standard-library package `fmt` and print `hello`. Confirm:

- `go build .` produces a binary.
- Running it prints exactly `hello`.
- The import block contains only `"fmt"`.

**Goal.** Re-establish the simplest possible import flow before doing anything tricky.

---

### Task 2 — Sub-package of your own module

Inside the same module, create a sub-folder `greet/` with a file `greet.go` containing `package greet` and a function `Hello() string`. From `main.go`, import `example.com/hello-import/greet` and call `greet.Hello()`. Confirm:

- The import path matches the module path plus the directory name.
- Removing the package declaration from `greet.go` produces a clear compile error.
- Renaming the directory does *not* automatically rewrite the import.

**Goal.** Internalise the rule that import paths follow directory paths.

---

### Task 3 — Import alias to disambiguate

Create two sub-packages of your module, both named `log` but in different directories: `audit/log/` and `app/log/`. Each should expose a function `Print(msg string)`. From `main.go`, import both with aliases:

```go
import (
    auditlog "example.com/hello-import/audit/log"
    applog   "example.com/hello-import/app/log"
)
```

Use both in a single `main`. Confirm:

- Removing either alias triggers a compile error: `log redeclared in this block`.
- The aliases are local to this file only — other files do not see them.

**Goal.** Practise the alias syntax against the most common collision case.

---

### Task 4 — Blank import for `image/png`

Write a small program that opens a `.png` file with `image.Decode`. First, write it *without* the blank import `_ "image/png"` and observe the runtime error: `image: unknown format`. Then add the blank import and confirm the file decodes. Run with a sample PNG of any size.

**Goal.** Understand that `image.Decode` relies on packages registering themselves at `init()` time — not at compile time.

---

### Task 5 — Cyclic-import error

Create two packages, `a` and `b`, each in its own folder under your module:

```
mod/
├── a/
│   └── a.go      package a, imports "mod/b"
└── b/
    └── b.go      package b, imports "mod/a"
```

Run `go build`. Capture the error verbatim. Then explain in two sentences why Go treats this as fatal and at what stage of compilation it is detected.

**Goal.** See, with your own eyes, that the Go toolchain refuses cyclic imports unconditionally.

---

## Medium

### Task 6 — `internal/` enforcement

Set up two modules in two adjacent folders:

```
projects/
├── lib/
│   ├── go.mod                (module example.com/lib)
│   ├── public/
│   │   └── public.go         (package public, calls private.Helper())
│   └── internal/
│       └── private/
│           └── private.go    (package private, exports Helper)
└── consumer/
    ├── go.mod                (module example.com/consumer)
    └── main.go               (tries to import example.com/lib/internal/private)
```

Use a `replace` in `consumer/go.mod` to point at `../lib`. Confirm:

- `lib/public` builds and can call `private.Helper()`.
- `consumer` fails to build with: `use of internal package not allowed`.

**Goal.** Watch the `internal/` rule act as a compiler-enforced visibility wall.

---

### Task 7 — Build-tag-gated import

Create a package that imports `golang.org/x/sys/unix` only on Linux. Use a constraint:

```go
//go:build linux

package myfs

import "golang.org/x/sys/unix"
```

Provide a stub file with `//go:build !linux` for other OSes. Confirm:

- `GOOS=linux go build` succeeds.
- `GOOS=darwin go build` succeeds and does *not* pull in `unix`.
- `go list -deps` differs between the two.

**Goal.** Use build tags to make platform-specific imports surgical.

---

### Task 8 — `goimports` reformat

Open a Go file and write its imports in deliberately non-standard order:

```go
import (
    "example.com/internal/foo"
    "fmt"
    "github.com/spf13/cobra"
    "os"
)
```

Run `goimports -w` on the file. Confirm:

- Standard-library imports come first.
- Third-party imports follow, separated by a blank line.
- Local-module imports appear last (or wherever `goimports` places them by default).
- The diff is what you expected.

**Goal.** Get hands-on with the formatter and stop fighting it.

---

### Task 9 — `package foo` vs `package foo_test`

Create a package `calc` with an exported function `Add` and an unexported helper `internalAdd`. Add two test files in the same directory:

- `calc_internal_test.go` with `package calc` — can call both `Add` and `internalAdd`.
- `calc_external_test.go` with `package calc_test` — can call only `Add`, and must `import "example.com/.../calc"`.

Run `go test ./calc/...`. Confirm both test files run, and that swapping which package each one declares produces matching compile errors.

**Goal.** Own the trade-off between white-box and black-box tests.

---

### Task 10 — Init order across three packages

Create three packages: `a`, `b`, `c`. Each has an `init()` that prints its name. Make `main` import `c`, `c` import `b`, and `b` import `a`. Run the binary. Confirm the output is exactly:

```
a
b
c
```

Then add a *second* file to package `b` whose `init()` prints `b2`. Predict the output before re-running. Confirm with the docs: within a single package, init order follows file name order, and within a file, init order is top-to-bottom.

**Goal.** Make init-order behaviour concrete instead of folkloric.

---

## Hard

### Task 11 — Break a cycle by extracting an interface

You inherit code with this cycle:

```
package storage   imports "package report"
package report    imports "package storage"
```

`report` calls `storage.Save`, and `storage` calls `report.Render` to embed a summary. Refactor:

1. Define a new interface in a third package `core`: `type Renderer interface { Render(s State) string }`.
2. Have `storage` accept a `Renderer` parameter rather than importing `report`.
3. Wire `report` as the concrete `Renderer` in `main`.

Confirm the cycle is gone with `go build ./...` and that no behaviour was lost.

**Goal.** Turn a cyclic-import problem into an architectural improvement.

---

### Task 12 — Plugin registry via blank imports

Build a tiny plugin system mimicking `database/sql`:

1. A `core` package exposes:

   ```go
   type Plugin interface{ Name() string; Run() error }
   func Register(name string, p Plugin)
   func Get(name string) (Plugin, bool)
   ```

2. Two plugin packages, `pluginhello` and `pluginbye`, each `init()` calls `core.Register(...)`.
3. A `main` package that imports the plugins with blank imports:

   ```go
   import (
       _ "example.com/plug/pluginhello"
       _ "example.com/plug/pluginbye"
   )
   ```

4. `main` then iterates `core.List()` and runs each plugin.

Demonstrate that *removing* one of the blank imports removes the plugin from the binary entirely.

**Goal.** Understand the registry-plus-blank-import pattern that powers SQL drivers, image decoders, and codec libraries.

---

### Task 13 — Enumerate every import with `go list -deps`

For a non-trivial program of yours, run:

```bash
go list -deps -f '{{.ImportPath}}' ./...
```

Sort and uniq the output. Now answer:

1. How many distinct packages does your binary depend on?
2. How many are standard library? Third party? Yours?
3. Which third-party module contributes the most packages?

Build a one-liner that prints just the third-party packages.

**Goal.** Develop the reflex of *measuring* import bloat instead of guessing.

---

### Task 14 — Programmatic import insertion via `astutil`

Write a small Go tool that:

1. Reads a target `.go` file.
2. Parses it with `go/parser`.
3. Uses `golang.org/x/tools/go/ast/astutil.AddImport(fset, file, "context")` to add `"context"` if missing.
4. Writes the file back using `go/printer`.

Run it on a file that does not yet import `"context"`. Confirm the import is added in the right block, the file still compiles, and `goimports` does not want to change anything.

**Goal.** Touch the API the official Go tools use to do safe, idempotent import edits.

---

### Task 15 — Layered architecture enforced via `internal/`

Set up:

```
example.com/app/
├── cmd/server/main.go
├── internal/
│   ├── handler/        (HTTP handlers; may import service)
│   ├── service/        (business logic; may import repo)
│   └── repo/           (database access; may NOT import service or handler)
```

Demonstrate:

1. `repo` cannot import `handler` or `service` — verify by trying and observing the build break (it will not actually break only via `internal/`; you also need a lint rule).
2. Add a `golangci-lint` config using `depguard` (or `import-restrictions`) to enforce the rule.

**Goal.** Combine `internal/` (which controls *external* visibility) with linters (which control *internal* directionality) for a real layered architecture.

---

## Bonus / Stretch

### Task 16 — Detect "imports too much" packages

Write a Go tool that walks your module with `go list -json ./...` and flags any package whose `Deps` list contains more than 50 packages. For each offender, print:

- The package path.
- The dep count.
- The five most "expensive" deps by transitive count (hardest to decouple from).

**Goal.** Build a cheap, data-driven import-hygiene metric you can run in CI.

---

### Task 17 — Forensic import graph from a binary

Take a Go binary you did not build (or one of yours from a prior project). Run:

```bash
go version -m ./binary
```

Extract:

1. The main module path.
2. The full list of `dep` lines.
3. The Go version it was built with.

Now construct a Graphviz `.dot` file showing the module-level import graph based on the `dep` list (modules only — Go does not embed package-level edges).

**Goal.** Treat shipped binaries as queryable artefacts.

---

### Task 18 — Heavy vs slim compile time

Write program A that imports `net/http`, `database/sql`, `text/template`, and `encoding/json`, but uses none of them in code (use blank imports if needed). Write program B that imports only `fmt`. Both print `hello`.

Compare:

- `time go build -o /tmp/A ./A` after `go clean -cache`.
- `time go build -o /tmp/B ./B` after `go clean -cache`.

Compare again with a warm cache. Discuss.

**Goal.** Quantify the cost of casual imports.

---

### Task 19 — Dot-import name collisions

Create a file that does:

```go
import (
    . "example.com/mathish/v1"
    . "example.com/mathish/v2"
)
```

Both packages export `Sum`. Build. Capture the error. Fix it by removing the dot imports and using qualified names. Then write a one-paragraph note for your team's style guide explaining why dot imports are banned outside test files.

**Goal.** Experience first-hand why dot imports are an anti-pattern.

---

### Task 20 — `goimports -local` for org grouping

In a project where you have:

- Standard-library imports.
- Third-party imports.
- Imports from your own org, e.g. `github.com/myorg/...`.

Run:

```bash
goimports -w -local github.com/myorg ./...
```

Confirm the resulting import block has *three* groups separated by blank lines. Add this to your project's pre-commit hook so engineers do not have to remember the flag.

**Goal.** Make import grouping a per-org convention, not a manual chore.

---

## Solutions (sketched)

### Solution 1
```go
package main

import "fmt"

func main() { fmt.Println("hello") }
```

### Solution 2
```go
// greet/greet.go
package greet
func Hello() string { return "hello" }
```
```go
// main.go
import "example.com/hello-import/greet"
func main() { fmt.Println(greet.Hello()) }
```
The import path is module path + directory path; package name is independent of directory name (though convention says they should match).

### Solution 3
Without aliases, `import "audit/log"` and `import "app/log"` would both try to bind the identifier `log` in the file scope. Aliases give them distinct names.

### Solution 4
```go
import (
    "image"
    _ "image/png"
    "os"
)
f, _ := os.Open("sample.png")
img, _, err := image.Decode(f)
```
Without `_ "image/png"`, decoding fails because no decoder is registered.

### Solution 5
```
import cycle not allowed
package mod/a
        imports mod/b
        imports mod/a
```
The cycle is detected during type-checking, before any code is generated. The Go spec forbids it because package init order would be undefined.

### Solution 6
The error from the consumer:
```
use of internal package example.com/lib/internal/private not allowed
```
The rule: `internal/X` is importable only from packages rooted at the directory containing `internal`. `example.com/consumer` is not under `example.com/lib/`, so the import is rejected.

### Solution 7
```go
//go:build linux

package myfs
import "golang.org/x/sys/unix"
// ...uses unix.Stat...
```
And a sibling:
```go
//go:build !linux

package myfs
// stub: no-op or returns ErrUnsupported
```
`go list -deps` will include `golang.org/x/sys/unix` only when `GOOS=linux`.

### Solution 8
After `goimports -w`:
```go
import (
    "fmt"
    "os"

    "github.com/spf13/cobra"

    "example.com/internal/foo"
)
```

### Solution 9
- `package calc` test files share scope: can use unexported names.
- `package calc_test` files compile separately: must import the package and use exported names only.
- Mixing: a single directory may contain both kinds of test files; the toolchain compiles them as two separate test binaries.

### Solution 10
First run prints:
```
a
b
c
```
After adding `b2.go` with another `init()`, output becomes:
```
a
b   (from b.go, alphabetically first)
b2  (from b2.go)
c
```
Rule: deps init first, then within a package files init in lexical order, then within a file init funcs run top-to-bottom.

### Solution 11
```go
// core/core.go
package core
type Renderer interface{ Render(s State) string }
```
```go
// storage/storage.go
package storage
import "example.com/app/core"
func Save(s State, r core.Renderer) { /* uses r.Render(s) */ }
```
```go
// report/report.go
package report
import "example.com/app/core"
type Reporter struct{}
func (Reporter) Render(s core.State) string { /* ... */ }
```
```go
// main.go
storage.Save(state, report.Reporter{})
```

### Solution 12
```go
// core/core.go
package core
var registry = map[string]Plugin{}
func Register(name string, p Plugin) { registry[name] = p }
func List() []Plugin { /* sorted */ }
```
```go
// pluginhello/init.go
package pluginhello
import "example.com/plug/core"
func init() { core.Register("hello", impl{}) }
```

### Solution 13
```bash
go list -deps -f '{{.ImportPath}}' ./... | \
  grep -v '^example.com/yourmodule' | \
  grep -v -F "$(go list std)"
```
Modules with the most packages tend to be observability libraries (OpenTelemetry), cloud SDKs, and gRPC.

### Solution 14
```go
fset := token.NewFileSet()
file, _ := parser.ParseFile(fset, path, nil, parser.ParseComments)
if astutil.AddImport(fset, file, "context") {
    var buf bytes.Buffer
    printer.Fprint(&buf, fset, file)
    os.WriteFile(path, buf.Bytes(), 0644)
}
```
`astutil.AddImport` is idempotent.

### Solution 15
`internal/` keeps `service`, `handler`, `repo` private to the module. To prevent `repo` from importing `service`, add a `.golangci.yml`:
```yaml
linters:
  enable: [depguard]
linters-settings:
  depguard:
    rules:
      repo:
        files: ["**/internal/repo/**"]
        deny:
          - pkg: "example.com/app/internal/service"
          - pkg: "example.com/app/internal/handler"
```

### Solution 16
```go
out, _ := exec.Command("go", "list", "-json", "./...").Output()
dec := json.NewDecoder(bytes.NewReader(out))
for {
    var p struct{ ImportPath string; Deps []string }
    if err := dec.Decode(&p); err != nil { break }
    if len(p.Deps) > 50 {
        fmt.Println(p.ImportPath, len(p.Deps))
    }
}
```

### Solution 17
```bash
go version -m ./binary | awk '$1 == "dep" { print $2, $3 }'
```
Build a `.dot`:
```
digraph G {
  "main-module" -> "github.com/x/y";
  "main-module" -> "github.com/a/b";
  // ...
}
```

### Solution 18
Cold-cache builds typically show A taking 5–20× longer than B. Warm cache narrows the gap because Go caches per-package compilation. The lesson: `import` is not free, especially in CI where caches are often cold.

### Solution 19
Compile error:
```
Sum redeclared in this block
        previous declaration at ...
```
Fix: drop the dots and use qualified names. Style guide: dot imports are reserved for `_test.go` files where they make `gomega.Expect`-style DSLs read well. Anywhere else, they make code unreadable to newcomers and break under aliasing.

### Solution 20
With `-local github.com/myorg`, `goimports` produces three groups: stdlib, third-party, your-org. Add to `.git/hooks/pre-commit`:
```bash
goimports -w -local github.com/myorg $(git diff --cached --name-only --diff-filter=ACM | grep '\.go$')
```

---

## Checkpoints

After completing the easy tasks: you can read any Go file's import block and predict what each line does, including aliases and blank imports.
After completing the medium tasks: you can use build tags, `internal/`, and external test packages deliberately rather than by accident.
After completing the hard tasks: you can refactor cyclic dependencies, build plugin systems, and write tooling that manipulates imports programmatically.
After completing the bonus tasks: you can audit, measure, and police the import graph of a real codebase — the level required to keep a large Go project healthy.
