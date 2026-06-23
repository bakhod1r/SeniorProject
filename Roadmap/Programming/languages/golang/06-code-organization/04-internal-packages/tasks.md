# Internal Packages — Hands-on Tasks

> Practical exercises from easy to hard. Each task says what to build, what success looks like, and a hint or expected outcome. Solutions are at the end.

---

## Easy

### Task 1 — Your first `internal/` package

In a fresh module, create one public package and one internal package. Confirm:

- The public package is at `<module>/greet/` and the internal one at `<module>/internal/words/`.
- `cmd/main.go` imports both and prints a greeting.
- `go build ./...` succeeds.

**Goal.** Walk the smallest possible "I have an internal package" path end-to-end.

---

### Task 2 — Force a forbidden-import error on purpose

Create a *second* module locally. Try to import the previous module's `internal/words` from the second module. Expect this error:

```
use of internal package <module>/internal/words not allowed
```

**Goal.** See the error message in your own terminal so you recognise it later.

---

### Task 3 — Two siblings, one shared `internal/`

Add two packages `<module>/handler/` and `<module>/service/`. Both should import `<module>/internal/log`. Confirm both build.

**Goal.** Confirm that any code under the parent of `internal/` may import.

---

### Task 4 — Move a public package into `internal/`

Take the `<module>/greet/` package from Task 1. Move it under `internal/`:

```bash
git mv greet internal/greet
```

Update every import. Run `go build ./...`. Run `go test ./...` if you have tests.

**Goal.** Practise the `git mv` plus import-update workflow.

---

### Task 5 — Move an internal package out

Reverse Task 4: move `internal/greet` back to `greet/`. Update imports. Confirm build.

**Goal.** Practise the demotion (promotion to public) workflow. Both directions should feel like one keystroke plus a sed.

---

## Medium

### Task 6 — Multi-level `internal/`

Reshape your project to:

```
project/
├── go.mod
├── handler/
│   ├── handler.go
│   └── internal/
│       └── parse/
│           └── parse.go
├── service/
│   └── service.go
└── internal/
    └── log/
        └── log.go
```

Confirm:
- `handler/handler.go` may import both `handler/internal/parse` and `internal/log`.
- `service/service.go` may import `internal/log` but **not** `handler/internal/parse`.

Add a `service` import for `handler/internal/parse` and capture the build failure. Then remove it.

**Goal.** Internalise the "feature-private vs module-private" distinction.

---

### Task 7 — Black-box tests for an `internal/` package

In `internal/log/`, write a `log_test.go` using `package log_test`. Import `<module>/internal/log` from the test. Confirm `go test ./...` succeeds.

**Goal.** Confirm tests inside the `internal/` subtree can use the public-style import.

---

### Task 8 — Tests in a top-level `tests/` directory

Create `tests/log_test.go`. Make it `package tests` and import `<module>/internal/log`. Confirm `go test ./...` succeeds.

Now move that file to a *different* module (a sibling repo with its own `go.mod`). Confirm the test fails to build with the rule's error.

**Goal.** Distinguish "outside the package, inside the parent" from "outside the parent, full stop."

---

### Task 9 — Refactor a leak

Take a project (yours or this exercise file's) where the public surface has accidentally exposed a helper. Identify the helper. Move it into `internal/`. Update imports. Run `go list ./... | grep -v internal` to verify it no longer appears in the public list.

If you have a real downstream consumer (or simulate one with a sibling module), watch the consumer break and document the migration.

**Goal.** Practise the surface-shrinking refactor with all its consequences.

---

### Task 10 — Promote an `internal/` package consciously

Pick an `internal/` package that has matured. Decide it should be public. Move it. Add:

- Package-level doc comment with a Synopsis.
- An `Example` test function.
- A line in `README.md` listing it as part of the public API.

Verify with `go doc <module>/<pkg>` and `go test ./... -v -run Example`.

**Goal.** Feel the *cost* of making something public. It is more work than hiding it.

---

### Task 11 — Identify the parent of `internal/` for any path

For each of the following import paths, write down the parent directory and the set of importers that would be allowed:

- `example.com/lib/internal/x`
- `example.com/lib/foo/internal/x`
- `example.com/lib/foo/internal/x/internal/y`
- `example.com/internalstuff/x` (note: `internal` is a *substring*)
- `example.com/lib/Internal/x` (capital `I`)

**Goal.** Train your eye to see the boundary at a glance. The last two are tricky — the rule does not fire on substrings or non-lowercase elements.

---

### Task 12 — `cmd/internal/` for shared CLI helpers

Add a layout where two binaries share helpers private to the `cmd/` subtree:

```
project/
├── go.mod
├── cmd/
│   ├── api/main.go
│   ├── worker/main.go
│   └── internal/
│       └── flagutil/
│           └── flagutil.go
└── internal/
    └── domain/
        └── domain.go
```

Confirm:
- Both `cmd/api` and `cmd/worker` may import `cmd/internal/flagutil`.
- `internal/domain` may *not* import `cmd/internal/flagutil`.

**Goal.** See multi-level `internal/` solving a real layout problem.

---

## Hard

### Task 13 — Refactor a real project's public surface

Take a Go project of your own (or fork a small open-source one). Walk its public surface:

```bash
go list ./... | grep -v '/internal/' > before.txt
```

For each entry, ask the surface-audit questions (stable? documented? necessary?). Identify three packages that should be hidden. Move them. Verify:

```bash
go list ./... | grep -v '/internal/' > after.txt
diff before.txt after.txt
```

If the project is published (`module example.com/yourthing`), draft release notes for a `v2.0.0` describing the breaking change.

**Goal.** Run the senior-level surface audit on a real codebase.

---

### Task 14 — Multi-module mono-repo with deliberate sharing

Build:

```
monorepo/
├── go.work
├── server/
│   ├── go.mod
│   └── internal/...
├── sdk/
│   ├── go.mod
│   └── ...
└── shared/
    ├── go.mod         ← intentional shared module
    └── ...
```

`server` and `sdk` both import `shared`. Neither imports the other's `internal/`. Confirm:

- The mono-repo builds with `go build ./...` from the root (workspace mode).
- Each module builds independently with its own `go.mod`.
- Neither `server` nor `sdk` can reach into the other's `internal/`.

**Goal.** Practise the discipline of multi-module mono-repos: deliberate sharing, no leaks.

---

### Task 15 — Build a tiny "is this import allowed" tool

Write a Go program that reads `go list -json ./...` output and reports any import that violates the `internal/` rule. The program should:

1. Parse `go list -json ./...` JSON.
2. For each package, walk its `Imports`.
3. For each import, run the algorithm from `professional.md` to decide allowability.
4. Print violations with importer, imported, and the parent of the offending `internal/` element.

Run it on a project with at least one violation (you may have to create one).

**Goal.** Implement the rule yourself. It will fit in 60 lines.

---

### Task 16 — Architectural enforcement with `depguard`

Add `golangci-lint` with `depguard` rules to one of your projects. Configure rules so that:

- `internal/repo/...` may not be imported from `internal/handler/...` directly (must go through `internal/service/...`).
- `internal/...` may not be imported from `cmd/...` (must go through a public façade or `internal/wiring/`).

Run the linter and watch it catch violations the toolchain would not.

**Goal.** See `internal/` and lint rules as complementary tools, not substitutes.

---

### Task 17 — Promote an `internal/` package across modules

Set up a scenario where one of your modules has `internal/util` that another module wants to use. Resolve it three ways:

1. Duplicate `util` in the second module.
2. Promote `util` to public in the first module.
3. Extract `util` into a third, dedicated module both depend on.

For each, document what changed in:
- `go.mod` files
- Import paths
- Release tags
- Stability commitments

**Goal.** Live the trade-offs of cross-module sharing.

---

### Task 18 — Write a "stability policy" for a real library

Pick a library you maintain (or a fictional one). Write a `STABILITY.md` covering:

- What is the public API? (`<module>/...` minus `/internal/`.)
- What stability does each public package promise (patch-level? minor? major-only?)?
- How is breakage announced? (`Deprecated:` comments, release notes, deprecation period.)
- What is the policy for promoting an `internal/` package to public?
- What is the policy for hiding a public package under `internal/`?

Add a CI check that diffs `public.txt` (the list of non-internal packages) on every PR.

**Goal.** Codify the senior-level discipline so contributors can't drift it.

---

## Bonus / Stretch

### Task 19 — Read the `cmd/go` source

Clone the Go source repository. Find the function that enforces `internal/`. Read it end to end. Find:

- The exact name of the function in your Go version.
- The error message it produces.
- Where the rule fires (load time vs build time).

Note the line count. It will be smaller than you expect.

**Goal.** Demystify the toolchain. The rule really is "ten lines of path manipulation."

---

### Task 20 — Port the rule to a different build system

If you use Bazel or Buck2, write a custom rule that enforces `internal/` on Go targets. (Or: just write the predicate and run it against your `BUILD.bazel` files.)

**Goal.** Confirm that the rule ports cleanly outside `cmd/go`.

---

## Solutions (sketched)

### Solution 1
```bash
mkdir hello && cd hello
go mod init example.com/hello
mkdir -p greet internal/words cmd
cat > greet/greet.go <<'EOF'
package greet

import "example.com/hello/internal/words"

func Hello(name string) string { return words.Greet() + ", " + name }
EOF
cat > internal/words/words.go <<'EOF'
package words

func Greet() string { return "hi" }
EOF
cat > cmd/main.go <<'EOF'
package main

import (
    "fmt"

    "example.com/hello/greet"
)

func main() { fmt.Println(greet.Hello("world")) }
EOF
go run ./cmd
```

### Solution 2
```bash
mkdir other && cd other
go mod init example.com/other
go mod edit -replace=example.com/hello=../hello
go mod edit -require=example.com/hello@v0.0.0
cat > main.go <<'EOF'
package main

import "example.com/hello/internal/words"

func main() { _ = words.Greet }
EOF
go build ./...
# main.go:3:8: use of internal package example.com/hello/internal/words not allowed
```

### Solution 3
Both `handler/handler.go` and `service/service.go` import `<module>/internal/log` and call its public function. Both compile because both live under the module root, which is the parent of `internal/`.

### Solution 4
```bash
git mv greet internal/greet
sed -i '' 's|example.com/hello/greet|example.com/hello/internal/greet|g' cmd/main.go
goimports -w .
go build ./...
```

### Solution 5
Same in reverse:
```bash
git mv internal/greet greet
sed -i '' 's|example.com/hello/internal/greet|example.com/hello/greet|g' cmd/main.go
goimports -w .
go build ./...
```

### Solution 6
The `service` import of `handler/internal/parse` produces:
```
service/service.go:3:8: use of internal package example.com/.../handler/internal/parse not allowed
```
Remove it; build succeeds.

### Solution 7
```go
// internal/log/log_test.go
package log_test

import (
    "testing"

    "example.com/hello/internal/log"
)

func TestPublicAPI(t *testing.T) {
    if log.Banner() == "" {
        t.Fatal("expected non-empty")
    }
}
```

### Solution 8
The `tests/` directory is inside the module root, which is the parent of `internal/`. The test compiles. When moved to a separate module, the rule rejects:
```
use of internal package example.com/hello/internal/log not allowed
```

### Solution 9
Pick (for example) a `Helper` function in `<module>/util/`. Move:
```bash
git mv util internal/util
goimports -w .
```
`go list ./... | grep -v internal` no longer shows `util`.

### Solution 10
```bash
git mv internal/util util
goimports -w .
```
Add `util/doc.go`:
```go
// Package util provides ...
package util
```
Add `util/example_test.go`:
```go
package util_test

import (
    "fmt"

    "example.com/hello/util"
)

func ExampleDoSomething() {
    fmt.Println(util.DoSomething("x"))
    // Output: ...
}
```

### Solution 11
| Path | Parent | Allowed importers |
|------|--------|--------------------|
| `example.com/lib/internal/x` | `example.com/lib` | anything under `example.com/lib/...` |
| `example.com/lib/foo/internal/x` | `example.com/lib/foo` | anything under `example.com/lib/foo/...` |
| `example.com/lib/foo/internal/x/internal/y` | `example.com/lib/foo/internal/x` | anything under `example.com/lib/foo/internal/x/...` (the deepest boundary wins) |
| `example.com/internalstuff/x` | — | anyone (`internal` is a substring, not a path element) |
| `example.com/lib/Internal/x` | — | anyone (`Internal` with capital I is not the magic name) |

### Solution 12
`cmd/internal/flagutil` is reachable from anything under `cmd/`. `internal/domain` is *not* under `cmd/`, so it gets:
```
use of internal package example.com/.../cmd/internal/flagutil not allowed
```

### Solution 13
Realistic before/after for a small library:
```
before.txt
example.com/lib
example.com/lib/api
example.com/lib/parser
example.com/lib/util       ← accidentally public
example.com/lib/cmd/cli

after.txt
example.com/lib
example.com/lib/api
example.com/lib/parser
example.com/lib/cmd/cli
```
Release notes: "v2.0.0 — `util` moved to internal/util; equivalents are now provided through Parser.Helper."

### Solution 14
```
go.work
go 1.22

use (
    ./server
    ./sdk
    ./shared
)
```
Each module's `go.mod` lists `replace example.com/shared => ../shared` for local development; once `shared` has a real version tag this can be removed.

### Solution 15
```go
package main

import (
    "encoding/json"
    "fmt"
    "os/exec"
    "strings"
)

type Pkg struct {
    ImportPath string
    Imports    []string
}

func parent(imported string) (string, bool) {
    elems := strings.Split(imported, "/")
    last := -1
    for i, e := range elems {
        if e == "internal" {
            last = i
        }
    }
    if last == -1 {
        return "", false
    }
    return strings.Join(elems[:last], "/"), true
}

func allowed(imported, importer string) bool {
    parent, ok := parent(imported)
    if !ok {
        return true
    }
    return importer == parent || strings.HasPrefix(importer, parent+"/")
}

func main() {
    out, _ := exec.Command("go", "list", "-json", "./...").Output()
    dec := json.NewDecoder(strings.NewReader(string(out)))
    for dec.More() {
        var p Pkg
        if err := dec.Decode(&p); err != nil {
            return
        }
        for _, imp := range p.Imports {
            if !allowed(imp, p.ImportPath) {
                fmt.Printf("VIOLATION: %s imports %s\n", p.ImportPath, imp)
            }
        }
    }
}
```

### Solution 16
```yaml
# .golangci.yml
linters:
  enable:
    - depguard
linters-settings:
  depguard:
    rules:
      no-handler-to-repo:
        files: ["**/internal/handler/**"]
        deny:
          - pkg: "example.com/.../internal/repo"
            desc: "handler must call service, not repo directly"
      no-cmd-to-internal:
        files: ["**/cmd/**"]
        deny:
          - pkg: "example.com/.../internal/"
            desc: "cmd/ wires through a façade, not directly"
```

### Solution 17
| Approach | go.mod changes | Stability commitment |
|----------|----------------|----------------------|
| Duplicate | none | none — each copy can drift |
| Promote | first module exposes a new public package | yes — first module owes stability |
| Extract third module | new `go.mod`, both modules `require` it | yes — third module owes stability |

### Solution 18
A skeleton `STABILITY.md`:

```
# Stability Policy

## Public API
Anything under `example.com/lib/...` *not* in an `internal/` directory.

## Stability Tiers
- Public packages: SemVer (patch / minor / major)
- `internal/` packages: free to change at any release

## Breaking changes
Any change to a public package signature requires a major version bump.

## Deprecation
Mark with `// Deprecated:`. Removed no earlier than the next major release.

## Promotion / hiding
- internal → public: requires a documented use case + senior review.
- public → internal: major version bump, release notes, deprecation period.
```

### Solution 19
The function (Go 1.22) is `disallowInternal` in `cmd/go/internal/load/pkg.go`. It is roughly 80 lines including comments and edge cases. The error message is:
```
use of internal package %s not allowed
```
The check fires during `loadPackage`, not during compilation.

### Solution 20
For Bazel `rules_go`, this is already implemented. For a custom rule, you would write a `genrule` or aspect that runs the algorithm from Solution 15 on every `go_library` target.

---

## Checkpoints

After completing the easy tasks: you can confidently create, move, and reason about `internal/` packages.

After medium: you can refactor public surfaces, scope visibility with multi-level `internal/`, and explain why the rule rejects in any given case.

After hard: you can audit a real codebase, design a multi-module mono-repo deliberately, and write tooling that enforces or extends the rule.
