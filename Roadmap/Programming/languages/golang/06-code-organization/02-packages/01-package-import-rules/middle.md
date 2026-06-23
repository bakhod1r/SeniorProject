# Package Import Rules — Middle Level

## Table of Contents
1. [Introduction](#introduction)
2. [The Import Path: Resolution Algorithm](#the-import-path-resolution-algorithm)
3. [Package Name vs Path Naming Conventions](#package-name-vs-path-naming-conventions)
4. [Aliasing in Real Code](#aliasing-in-real-code)
5. [Blank Imports: Real-World Use Cases](#blank-imports-real-world-use-cases)
6. [Dot Imports: Why They Exist and Why You Should Avoid Them](#dot-imports-why-they-exist-and-why-you-should-avoid-them)
7. [The `internal/` Mechanism: Beyond the Basics](#the-internal-mechanism-beyond-the-basics)
8. [The Initialization Order Algorithm](#the-initialization-order-algorithm)
9. [Cyclic Imports: Detection and Avoidance Strategies](#cyclic-imports-detection-and-avoidance-strategies)
10. [Imports and Vendor Mode](#imports-and-vendor-mode)
11. [Imports and Build Tags](#imports-and-build-tags)
12. [The `goimports` Tool and Standard Grouping](#the-goimports-tool-and-standard-grouping)
13. [Imports in Test Files](#imports-in-test-files)
14. [Common Errors and What They Mean](#common-errors-and-what-they-mean)
15. [Best Practices for Established Codebases](#best-practices-for-established-codebases)
16. [Pitfalls You Will Meet](#pitfalls-you-will-meet)
17. [Self-Assessment](#self-assessment)
18. [Summary](#summary)

---

## Introduction

You already know what `import "fmt"` does. The middle-level question is *how the toolchain finds that package*, *what name it ends up bound to in your file*, and *what subtle rules govern visibility, ordering, and aliasing*.

This file zooms out from the keyword to the surrounding mechanics: the resolver's search order, the difference between a package's path and its identifier, the precise semantics of `internal/`, the initialization order, and the practical conventions that production codebases settle on.

After reading this you will:
- Trace how the compiler resolves any import path on disk
- Know when a package name will not match its path's last segment
- Use aliases, blank imports, and dot imports for the right reasons
- Apply `internal/` to enforce architectural boundaries
- Predict the order in which `init()` functions run
- Refactor your way out of cyclic-import errors
- Read `goimports` output and understand its three-group convention

---

## The Import Path: Resolution Algorithm

An `import` statement contains a path string. The toolchain's job is to map that string to a directory of `.go` files. Since Go 1.16, modules-aware mode is the default, and the algorithm is roughly:

1. **Standard library first.** If the path is one of the known stdlib packages (`fmt`, `os`, `net/http`, ...), the compiler reads it from `GOROOT/src/<path>`. Stdlib paths never contain a dot — that is how the toolchain distinguishes them.
2. **Vendor directory (if applicable).** If you build with `-mod=vendor` (or the `go.mod` contains `go 1.14+` and a `vendor/` directory exists), the resolver walks up from the importing file looking for `vendor/<path>`. The first match wins.
3. **Module cache.** Otherwise the resolver looks up the path in the active module graph: which module owns this prefix, and at what version? It then reads the package from `$GOMODCACHE/<module>@<version>/<sub-path>`.
4. **The current module.** If the path begins with the current module's path (the `module` line of `go.mod`), the resolver reads from your working tree, not the cache.
5. **Failure.** If none of the above produce a directory containing `.go` files with a consistent `package` clause, the build fails with `cannot find package` or `no Go files in ...`.

A few subtleties:

- The resolver does *not* perform DNS lookups on `github.com/...` at build time. It uses what is already in the module cache (or vendor/, or the current module). Network access happens during `go get` or `go mod download`, not during `go build`.
- The first segment of the path is what determines stdlib vs external. Stdlib paths have no dot in the first segment. `net/http` is stdlib; `example.com/net/http` is not.
- `replace` directives in `go.mod` rewrite paths *before* resolution. A path like `github.com/old/x` may end up reading from `../localfork`.

### A worked example

Given:

```go
import (
    "fmt"
    "net/http"
    "github.com/spf13/cobra"
    "myapp/internal/auth"
)
```

In a module `myapp` at `go 1.22`:

- `fmt` → `$GOROOT/src/fmt/`.
- `net/http` → `$GOROOT/src/net/http/`.
- `github.com/spf13/cobra` → `$GOMODCACHE/github.com/spf13/cobra@v1.8.0/` (whatever the locked version is).
- `myapp/internal/auth` → `./internal/auth/` in the current working tree.

If you switch to `-mod=vendor`, the third import becomes `./vendor/github.com/spf13/cobra/`.

---

## Package Name vs Path Naming Conventions

A subtle distinction trips up engineers reading import lines for the first time:

- The **path** is what you write in `import "..."`.
- The **package name** is what you actually use as the identifier in your code (`cobra.Command`, `yaml.Unmarshal`).

These usually match the last segment of the path, but not always.

### The conventions for the package name

The Go community has settled on:

- **Lowercase only.** No `MyPackage`, no `myPackage`. Just `mypackage`.
- **No underscores or hyphens.** `package mypackage`, never `package my_package` or `package my-package`. (The path may contain hyphens, but the name strips them.)
- **Short.** One or two words. `http`, `bufio`, `auth`, `userrepo`. Long names create noisy call sites.
- **Singular by default.** `package user`, not `package users`. The plural feels right when reading the import line but wrong at every call site.
- **Avoid stuttering.** If the package is `auth`, do not name a function `auth.AuthLogin`. Just `auth.Login`. The package name is already there.

### When the name does not match the path

Sometimes the last segment of the path is not a valid Go identifier, or the maintainers chose a different name on purpose:

| Path | Package name |
|------|--------------|
| `gopkg.in/yaml.v3` | `yaml` |
| `gopkg.in/check.v1` | `check` |
| `github.com/go-sql-driver/mysql` | `mysql` |
| `github.com/lib/pq` | `pq` |
| `golang.org/x/text/encoding/unicode` | `unicode` |

The `.v3` suffix is part of the path (used by gopkg.in's versioning convention) but not part of the name. The hyphen in `go-sql-driver` is a path-only character. In all these cases, the file's `package` clause is the source of truth.

When the path's last segment is a reserved identifier (like a Go keyword) or contains a dot, the package author *must* declare a different name. When it is just hard to type, they often do anyway.

### Reading an unfamiliar import

If you see `import "gopkg.in/yaml.v3"` and do not know the name to use, two options:

1. Open the package's `doc.go` or any `.go` file — the first non-comment line is `package yaml`.
2. Look at the package's documentation: pkg.go.dev shows the name explicitly.

Or just let `goimports` add the import for you and read what it wrote.

---

## Aliasing in Real Code

The syntax `import alias "path"` rebinds the package's local name. There are three legitimate reasons to use it.

### Reason 1: Resolving collisions

Two packages with the same name imported into one file:

```go
import (
    cryptorand "crypto/rand"
    mathrand   "math/rand"
)
```

Without aliases, both want to be called `rand`, and the file would not compile. Naming both explicitly makes call sites self-documenting:

```go
mathrand.Intn(10)
cryptorand.Read(buf)
```

### Reason 2: Disambiguating major versions

When two majors of the same module appear in one build closure (rare but real):

```go
import (
    cobra1 "github.com/spf13/cobra"
    cobra2 "github.com/spf13/cobra/v2"
)
```

This typically happens during a migration window. The aliases keep the file readable.

### Reason 3: Adapting an awkward generated name

A protobuf-generated package may be named `userpb`. If your domain code already has a `user` package, you might import the protobuf one as:

```go
import userpb "myapp/proto/user"
```

The alias matches the generated name; the import line is informative.

### The "rename for clarity" anti-pattern

Resist the temptation to alias a package just because *you* find a shorter or longer name nicer:

```go
// BAD
import h "net/http"
import HTTP "net/http"
```

The community has agreed on `http` for `net/http`. Aliasing it for taste creates noise: every reader has to learn your local convention. Aliases are for collisions and disambiguation, not personal preference.

A reasonable rule: do not alias unless the build forces you to.

---

## Blank Imports: Real-World Use Cases

The `_` alias means *import this package for its side effects only; do not bind a name*:

```go
import _ "github.com/lib/pq"
```

This is not a hack. The Go authors built it for a specific reason: many packages register themselves with a global registry in their `init()` function. Importing them is the only way to trigger that registration; you never need to call any of their exported names.

### Use case 1: SQL drivers

The `database/sql` package is generic — it does not know about Postgres or MySQL. Drivers register themselves:

```go
import (
    "database/sql"
    _ "github.com/lib/pq"
)

db, err := sql.Open("postgres", "postgres://...")
```

`sql.Open` looks up the `"postgres"` driver in a global map populated by `pq.init()`. Without the blank import, `sql.Open` would return *unknown driver*.

### Use case 2: Image format registration

The `image` package decodes images by format, but each format is its own sub-package:

```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
    _ "image/gif"
)

img, format, err := image.Decode(reader)
```

`image.Decode` consults a registry that each format package fills via `init()`. If you forget the blank import, the decoder reports *unknown format* even on a clearly valid PNG.

### Use case 3: HTTP profiling

Importing `net/http/pprof` for its side effect of attaching profiling handlers to the default `http.ServeMux`:

```go
import _ "net/http/pprof"
```

After this, `http://localhost:6060/debug/pprof/` is live (assuming you have an HTTP server running on the default mux). You write no further code.

### When NOT to use blank imports

A blank import means *I want this package's side effects but none of its API*. If you also call functions from the package, do not blank-import it; use the real name. And avoid blank-importing packages that have no documented side-effect contract — you are relying on undocumented `init()` behavior, which the maintainer is free to change.

---

## Dot Imports: Why They Exist and Why You Should Avoid Them

The `.` alias dumps the package's exported names into the importing file's namespace:

```go
import . "fmt"

func main() {
    Println("hello")  // No "fmt." prefix
}
```

This was included for a small set of legitimate reasons, mostly around test DSLs.

### Where they appear in the wild

- **Ginkgo and Gomega** (BDD testing for Go) use dot imports so that `Describe`, `It`, `Expect`, and friends read like keywords:
    ```go
    import (
        . "github.com/onsi/ginkgo/v2"
        . "github.com/onsi/gomega"
    )

    var _ = Describe("user", func() {
        It("logs in", func() {
            Expect(login()).To(Succeed())
        })
    })
    ```
- **Internal test helpers** in some codebases dot-import a `testutil` package to bring `AssertEqual`, `MustNoError`, etc. into scope without prefixes.

### Why you should avoid them in production code

- **Identifier source becomes invisible.** A reader sees `Println`, `Describe`, `Expect` with no clue which package owns them. Static analysis tools and `gopls` jump-to-definition compensate, but readability suffers without tools.
- **Name collisions become silent.** Two dot-imported packages with overlapping names produce a compile error; one dot-imported package with a name that collides with a local symbol overrides the local one in subtle ways.
- **Refactoring becomes risky.** Renaming or removing a dot-imported package's symbol may not break the build cleanly until your imports get re-evaluated.
- **The community standard rejects them.** Most style guides (Uber's, Google's, Effective Go) explicitly discourage dot imports outside of testing DSLs.

### Rule of thumb

Use dot imports only where a testing framework explicitly recommends them. Never in non-test production code. If your team uses Ginkgo, document the convention; otherwise, avoid.

---

## The `internal/` Mechanism: Beyond the Basics

You probably know `internal/` makes packages "private." The precise rule is more interesting than that.

### The exact rule

A package whose import path contains an `internal/` segment can only be imported by packages whose path is *rooted at the parent of that `internal/` segment*.

Concretely, given:

```
myapp/
├── go.mod                ← module: myapp
├── api/
│   └── handler.go
├── internal/
│   └── auth/
│       └── auth.go
└── service/
    ├── user/
    │   ├── user.go
    │   └── internal/
    │       └── hashing/
    │           └── hashing.go
    └── billing/
        └── billing.go
```

- `myapp/internal/auth` is importable by any package under `myapp/`. Its parent-of-`internal/` is `myapp/`, and every other package in the module is "under" `myapp/`. So `api/handler.go` can import it; `service/billing/billing.go` can import it.
- `myapp/service/user/internal/hashing` is importable *only* by packages under `myapp/service/user/`. So `myapp/service/user/user.go` can import it. But `myapp/service/billing/billing.go` cannot — it is a sibling, not a descendant.

The rule is "can be imported by code rooted at the directory that *contains* the `internal/`." Siblings of that directory are excluded; cousins and grandchildren and beyond are excluded.

### Why this matters architecturally

- You can hide implementation details from one part of your codebase while exposing them to another, without splitting the module.
- You can prevent accidental cross-domain dependencies. `service/billing` cannot reach into `service/user`'s private hashing, so a refactor of `user` cannot silently break `billing`.
- You can isolate experimental code: put it in a deeply-nested `internal/`, and consumers literally cannot depend on it from elsewhere.

### What it does not do

- It does not encrypt or obfuscate. The source is still readable; you just cannot import the package from disallowed locations.
- It does not protect against `go run` of the package directly, or against vendoring it manually.
- It does not extend across modules. Another module's `internal/` is opaque to you, but your own module's `internal/` is fully reachable from anywhere within your module that the rule allows.

### Pattern

A common starter layout uses one top-level `internal/` for module-private code and exposes only the `cmd/` and (optionally) public package directories. Anything under `internal/` is fair game to refactor; anything outside is part of the module's API contract.

---

## The Initialization Order Algorithm

Go runs package initialization deterministically. Knowing the order helps you reason about `init()` functions, package-level variable expressions, and the order side effects fire.

### The algorithm

When the runtime starts a Go program, it must initialize every package the program transitively depends on. The rule is:

1. **Imports first, depth-first.** Before package P initializes, every package P imports must already be initialized. Each dependency's dependencies must be initialized before the dependency. The graph is walked in a depth-first manner.
2. **Each package is initialized exactly once**, even if multiple paths lead to it.
3. **Within a single package**, source files are processed *in alphabetical order of file name*.
4. **Within a single file**, declarations are processed top-to-bottom.
5. **Variable declarations are initialized in dependency order**, not source order. If `var a = b + 1` and `var b = 2`, the runtime initializes `b` first.
6. **All package-level variables are initialized before any `init()` function in that package runs.**
7. **`init()` functions run in source order**, file-by-file, in the alphabetical file order from rule 3.
8. **`main.main()` runs last.**

### A worked example

Given two files in `package config`:

```go
// alpha.go
package config

var defaultMode = "prod"

func init() {
    fmt.Println("alpha init")
}
```

```go
// beta.go
package config

var defaultPort = 8080

func init() {
    fmt.Println("beta init")
}
```

Order:
1. `defaultMode` is set to `"prod"` (alpha.go, alphabetical first).
2. `defaultPort` is set to `8080` (beta.go).
3. `init()` from alpha.go runs → prints `alpha init`.
4. `init()` from beta.go runs → prints `beta init`.

### Why this matters

- **`init()` is your only chance to run code at program-start without explicit calls.** Drivers, format registrations, and feature flags all rely on this.
- **Cross-file order should not be relied upon.** If you find yourself depending on `alpha.go` running before `beta.go`, refactor — that coupling is fragile to renames.
- **Cross-package order is reliable** as long as the import graph reflects the dependency. If package `A` imports `B`, then `B.init()` runs before `A.init()`.

### Multiple `init()` per file

A single file can contain multiple `init()` functions:

```go
func init() { /* register driver */ }
func init() { /* set up logger */ }
```

They run in source order. This is sometimes used to keep distinct concerns visually separated, though most code uses a single `init()` per file.

---

## Cyclic Imports: Detection and Avoidance Strategies

The Go compiler refuses to compile a program where package A imports package B and B (transitively) imports A. The error is brief and clear:

```
import cycle not allowed
package myapp/a
        imports myapp/b
        imports myapp/a
```

The toolchain detects cycles immediately at build time. There is no runtime detection because there is no runtime cycle to detect.

### Why cycles are forbidden

Initialization is the practical reason. If A depends on B and B depends on A, neither can finish initializing first. The language designers chose to forbid the situation entirely rather than introduce lazy resolution.

### The four refactoring strategies

When you hit a cycle, you have four standard moves.

#### Strategy 1: Interface extraction

Often a cycle exists because A and B both want to call methods on each other. Move the smaller interface into a third package both can import.

Before:
```
package user → imports billing
package billing → imports user (for User type)
```

After:
```
package user
package billing → imports user
package useriface → defines interface UserGetter (no imports)
package user → imports useriface
```

The cycle is broken because `useriface` has no imports; it is a leaf.

#### Strategy 2: Dependency inversion

A high-level package should not import a low-level one's concrete types. Define the low-level needs as interfaces in the high-level package and let the low-level package satisfy them.

Before:
```
package handler → imports postgres
package postgres → imports handler (for HandlerError type)
```

After:
```
package handler defines its own error type
package postgres imports handler
```

Anything `postgres` needed from `handler` either gets duplicated (if small) or moved into a shared types package.

#### Strategy 3: Splitting types into a sub-package

If both packages share a few struct types, extract those types into a new package both import:

```
package types  ← User, Order, Address (no behavior, just structs)
package user → imports types
package order → imports types
```

This is the simplest fix when the cycle is "they both want my types."

#### Strategy 4: Merging packages

If two packages are so tightly coupled they keep producing cycles, perhaps they should be one package. Merging is a real and underused option. If A and B always change together, they are one concept; the package boundary is fictional.

### Detection in IDEs

Most Go IDEs (`gopls`, GoLand) flag the cycle the moment you save the offending import, before you even build. Build-tool detection is fast but post-hoc; editor detection prevents the cycle from ever existing.

---

## Imports and Vendor Mode

`vendor/` is a directory at your module root containing copies of all dependencies. When the build runs in *vendor mode*, the resolver consults `vendor/` before the module cache.

### Activating vendor mode

- Automatically: when `go.mod` declares `go 1.14` or later AND a `vendor/` directory exists.
- Explicitly: pass `-mod=vendor` to any build command.
- Disabled: pass `-mod=mod` to ignore `vendor/` even if it exists.

### Effect on import resolution

```
import "github.com/spf13/cobra"
```

In module mode: resolves to `$GOMODCACHE/github.com/spf13/cobra@<version>/`.
In vendor mode: resolves to `./vendor/github.com/spf13/cobra/`.

The compiler does not consult the network in either case. Vendor mode is purely a different on-disk lookup.

### Generating a vendor directory

```bash
go mod vendor
```

This copies the exact set of files that would be used by the current module graph into `vendor/`, and writes `vendor/modules.txt` listing what is there. The directory is then meant to be committed.

### When to vendor

- Air-gapped or restricted-network build environments.
- Hermetic build reproducibility for security-sensitive projects.
- Legacy projects (pre-modules) being kept on familiar tooling.

### When not to vendor

- Regular projects with stable network access. The module cache plus `go.sum` already provide reproducibility.
- Open-source libraries — vendoring inside a library produces double-vendoring at the consumer.

If you do vendor: re-run `go mod vendor` after any dependency change, and have CI verify that `vendor/` is consistent with `go.mod`.

---

## Imports and Build Tags

A build tag at the top of a `.go` file controls whether that file participates in a given build:

```go
//go:build linux

package monitor
```

If the build target is not Linux, the toolchain does not parse the file at all — including its imports. This has consequences.

### Per-platform imports

A `monitor_linux.go` file may import a Linux-only library; `monitor_darwin.go` imports a macOS-only one. The build tag (often implicit in the filename suffix) ensures only one is compiled on each platform:

```go
// monitor_linux.go
//go:build linux

package monitor
import "github.com/prometheus/procfs"
```

```go
// monitor_darwin.go
//go:build darwin

package monitor
import "github.com/shirou/gopsutil/v3/host"
```

### Filename conventions

Files named `*_linux.go`, `*_darwin.go`, `*_windows.go`, `*_amd64.go`, `*_arm64.go` carry an implicit build tag based on the suffix. You do not need a `//go:build` line. Combining filename suffixes with explicit tags is allowed but rare.

### Tools and build tags

Static-analysis tools (vet, lint, gopls) need to know which tags to apply. Most default to the host platform's tags. To analyze code for another platform you typically pass `-tags=linux,arm64` (or the equivalent) explicitly. Imports invisible under the current tags are also invisible to those tools, which can hide errors during development.

### Build tags and `goimports`

`goimports` only sees the imports of the *current* build configuration. Running it on Linux will reorganize the Linux file's imports correctly but ignore the macOS-tagged file. To verify all platforms, run formatting under each tag set in CI, or use `-tags` to broaden the analysis.

---

## The `goimports` Tool and Standard Grouping

`goimports` is the de-facto formatter for the `import` block. It does two things `gofmt` does not:

1. **Adds missing imports** based on identifiers used in the file.
2. **Removes unused imports** (the same way `gofmt` would, but more eagerly).

It also enforces a grouping convention that the community has settled on:

```go
import (
    "fmt"
    "net/http"
    "strings"

    "github.com/spf13/cobra"
    "go.uber.org/zap"

    "myapp/internal/auth"
    "myapp/service/user"
)
```

Three groups, separated by blank lines:

1. **Standard library.**
2. **Third-party (anything containing a dot in the first segment, not the current module).**
3. **Intra-module (paths beginning with the current module's path).**

The grouping is not enforced by `goimports` by default; it is enforced by **`goimports -local <module-path>`**. With `-local`, the third group is split off from the second. Many projects wire `goimports -local <their-module>` into their pre-commit hook or CI.

### Why the convention matters

- It tells a reader at a glance: this file uses A, B, and C from outside; it relies on D and E from our own module.
- It makes diffs cleaner — adding a stdlib import does not jostle a third-party import.
- It mirrors the resolution algorithm: stdlib first, third-party second, current module last.

### IDE integration

Most editors run `goimports` (with `-local`) on save. If yours does not, configure it. Hand-formatted import blocks drift over time and produce noisy diffs.

### Alternatives

`gci` is a stricter formatter with explicit group ordering. `gofumpt` is a stricter `gofmt`. Either is fine; pick one and standardize.

---

## Imports in Test Files

Go has two ways to write tests, and they have different import rules.

### Internal test files

```go
// user_test.go
package user

import "testing"

func TestPrivateHelper(t *testing.T) {
    if computeKey(...) != ... { /* ... */ }
}
```

Same `package user` clause as the production code. The test file can call unexported functions (`computeKey`). Imports work identically to production code.

### External test files

```go
// user_external_test.go
package user_test

import (
    "testing"
    "myapp/service/user"
)

func TestPublicAPI(t *testing.T) {
    u := user.New(...)
}
```

`package user_test` is a special, *separate* package the toolchain recognizes. It coexists with `package user` in the same directory. Two consequences:

- The external test cannot call unexported functions of `user`. It can only use the public API.
- The external test can import packages that `user` itself cannot — useful when you want to import a higher-level helper that depends on `user`, without creating a cycle.

### When to use which

- **Internal test (`package user`)**: when you need to test internals (private functions, unexported state).
- **External test (`package user_test`)**: when you want to verify the *contract* — what callers will actually experience. Or when you would otherwise have a cycle.

A package may have both kinds of test files in the same directory. The test binary is built with both.

### Imports inside `_test.go` files

Test files can import packages that the production code does not. Common pattern: `testify/require`, `testify/assert`, internal `testutil`. These do not bloat the production binary because `_test.go` files are excluded from `go build`.

---

## Common Errors and What They Mean

### `imported and not used: "fmt"`

A package was imported but no identifier from it appears in the file. Either remove the import or, if you want it for side effects, alias it as `_`. `goimports` removes these automatically.

### `cannot find package "github.com/foo/bar" in any of: ...`

The resolver did not find the path on disk. Causes:
- Forgot to `go get`.
- The module is in `go.mod` but the cache is stale: try `go mod download`.
- A `replace` points to a missing local path.

### `package github.com/foo/bar is not in std`

Path looks like a stdlib path (no dot) but is not actually in the standard library. Usually a typo — `path/filepath` versus `path-filepath`.

### `import cycle not allowed`

See the cyclic imports section. Apply one of the four refactoring strategies.

### `use of internal package github.com/foo/internal/x not allowed`

You imported an `internal/` package from outside the allowed subtree. Move your code under the parent of `internal/`, or move the package out of `internal/`, or duplicate the symbols you need.

### `ambiguous import: found package x in multiple modules`

Two modules in the build graph both claim the same package path. Usually a sign that a `replace` directive is misconfigured, or you have both `github.com/x/y` and `github.com/x/y/v2` and confusion has set in.

### `package command-line-arguments`

You ran `go run file.go` outside any module, or with the working tree in a strange state. The build system is using a synthetic package name. Usually harmless, but a sign you might want a real `go.mod`.

---

## Best Practices for Established Codebases

1. **Run `goimports -local <module>` on save and in CI.** Standardize grouping; never debate it again.
2. **Default to no aliases.** Add an alias only when the build forces one.
3. **Confine dot imports to test DSLs.** Treat them as a smell elsewhere.
4. **Use blank imports only with documented side effects.** SQL drivers, image formats, profilers.
5. **Put module-private code under `internal/`.** Encode architectural boundaries with sub-`internal/` directories where appropriate.
6. **Forbid cycles early.** Run `go vet` and `go build` in CI; they catch cycles on the first import that creates one.
7. **Avoid relying on file-name alphabetical order for `init()` semantics.** If two `init()` functions must run in a specific order, put them in one file.
8. **Document any non-obvious `init()` side effect.** A reader of your `import _` line should be able to find the registration in a `doc.go`.
9. **Never vendor unless you need to.** Module mode plus `go.sum` is enough for almost everyone.

---

## Pitfalls You Will Meet

### Pitfall 1 — Forgotten blank import

A new developer removes `_ "github.com/lib/pq"` because "it is unused." `sql.Open("postgres", ...)` then fails at runtime, often only in production. Fix: add a comment beside every blank import explaining what it registers.

### Pitfall 2 — Aliased package shadowing a local variable

```go
import json "encoding/json"

func process(json []byte) { ... }  // BAD: shadowed the import
```

The function parameter shadows the package alias. Inside `process`, `json.Unmarshal` no longer compiles. Fix: rename the parameter, or do not alias.

### Pitfall 3 — `internal/` rule misunderstood

A team puts `internal/auth` at the module root and tries to import it from `cmd/server/main.go`. That works. They later create `service/billing/cmd/billing-server/main.go` and try to import `service/billing/internal/billing`. That also works (descendant). But `service/billing/cmd/billing-server` cannot import `service/user/internal/userrepo` (sibling-of-sibling). The mental model "anything in `internal/` is private" is wrong; it is "private to the parent subtree."

### Pitfall 4 — Init ordering used as a feature

Code relies on `aaa.go`'s `init()` running before `bbb.go`'s. A refactor renames `aaa.go` to `users.go` and the program breaks at startup. Fix: put both `init()` bodies in one file, or call them explicitly from a single `init()`.

### Pitfall 5 — Cycle hidden by build tags

`a.go` (no tag) imports B; `b_linux.go` (linux only) imports A. On macOS, no cycle. On Linux CI, the build fails. Always test cycles under all build tag sets you support.

### Pitfall 6 — Vendor and module cache disagree

A dependency was updated in `go.mod` but `vendor/` was not regenerated. Local builds (vendor mode) use the old code; CI builds (module mode) use the new code. Fix: CI step that runs `go mod vendor` and fails on diff.

### Pitfall 7 — Dot import in production

Someone copy-pasted an example using `import . "fmt"` into real code. A reader wonders where `Println` comes from. Fix: remove dot imports from non-test code; configure a linter to flag them.

### Pitfall 8 — Inconsistent `goimports` configuration

Some developers run `goimports` with `-local`, some without. Pull requests churn the import block back and forth. Fix: standardize via Makefile target or pre-commit hook.

---

## Self-Assessment

You can move on to [senior.md](senior.md) when you can:

- [ ] Trace how an import path resolves on disk in module mode and vendor mode
- [ ] Explain when a package's name will not match the last segment of its path
- [ ] Justify (or rule out) every alias, blank import, and dot import in a codebase
- [ ] State the precise `internal/` visibility rule and apply it to a layout
- [ ] Predict the order in which `init()` functions and package variables run
- [ ] Resolve a cyclic-import error using interface extraction or type splitting
- [ ] Read a `goimports`-formatted block and identify the three groups
- [ ] Explain why `package foo_test` cannot reach unexported symbols of `package foo`
- [ ] Diagnose every error in section 14 from the message alone

---

## Summary

Imports look mechanical but encode several architectural decisions. The path is resolved through a deterministic algorithm — stdlib, vendor, module cache, current module — that you can predict without running the compiler. The package's identifier in code is *separate* from the path's last segment, and a small but real number of packages exploit that. Aliases, blank imports, and dot imports all exist for narrow, justified reasons; treating them as defaults rather than exceptions makes code harder to read. The `internal/` rule is more precise than "private" — it is "private to the parent subtree." Initialization is depth-first by import graph, alphabetical within a package, and variables before `init()`. Cycles are forbidden absolutely, and there are exactly four refactoring strategies; pick one. The goimports three-group convention has won; standardize early. Apply these rules consistently, and the import block at the top of every file becomes a small, reliable summary of what each file actually depends on.
