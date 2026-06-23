# Internal Packages — Find the Bug

> Each scenario contains a real-world bug related to Go's `internal/` rule. Find it, explain it, fix it. Solutions are inline below each scenario.

---

## Bug 1 — Forbidden import from a sibling module

```
project/
├── server/
│   ├── go.mod                          ← module example.com/server
│   └── internal/
│       └── auth/
│           └── auth.go
└── client/
    ├── go.mod                          ← module example.com/client
    └── main.go
```

`client/main.go`:

```go
package main

import "example.com/server/internal/auth"

func main() {
    _ = auth.Login
}
```

```
$ go build ./...
main.go:3:8: use of internal package example.com/server/internal/auth not allowed
```

**Bug:** `server/` and `client/` look like one repository, but each has its own `go.mod`. From the toolchain's view they are *different* modules. The `internal/` rule is module-scoped — `client` is not "inside the parent" of `server/internal/auth`, even though both directories sit next to each other on disk.

**Fix:** decide what kind of sharing you want.

```bash
# Option A: merge into one module — delete server/go.mod or client/go.mod and use one root go.mod
# Option B: promote auth to server's public surface
git mv server/internal/auth server/auth
goimports -w .
# Option C: extract auth into a third dedicated module
mkdir -p auth
mv server/auth/* auth/
cd auth && go mod init example.com/auth
```

The rule is telling you "these are two modules — sharing internals is not allowed." Pick a strategy that respects that.

---

## Bug 2 — `replace` to bypass `internal/`

```go.mod
module example.com/myapp

go 1.22

require example.com/upstream v1.0.0

replace example.com/upstream/internal/helper => ./local-helper
```

```go
import "example.com/upstream/internal/helper"
```

```
$ go build ./...
main.go:3:8: use of internal package example.com/upstream/internal/helper not allowed
```

**Bug:** the team thought `replace` could bypass the `internal/` rule. It cannot. `replace` redirects the *bytes* used to satisfy an import; it does not change the *import path*. The rule fires on the import path, before `replace` is consulted.

**Fix:** stop trying to bypass the rule. If you need the helper:

- Use the upstream's public API (the one it intentionally exposes).
- Fork upstream into your own module path; now your fork's import path is yours, and the helpers are reachable from inside your fork.
- File an upstream issue asking for the helper to be promoted to public.

```bash
# Forking strategy:
go mod edit -dropreplace=example.com/upstream/internal/helper
go mod edit -require=example.com/myorg/upstream@v1.0.0-fork.1
# update import paths in source: example.com/upstream → example.com/myorg/upstream
goimports -w .
```

`replace` is for *swapping content of a path*, not *unlocking visibility*.

---

## Bug 3 — Vendored copy "should" be visible

```
myapp/
├── go.mod                          ← module example.com/myapp
├── main.go
└── vendor/
    └── example.com/upstream/
        ├── pub.go                  ← package upstream
        └── internal/
            └── helper/
                └── helper.go       ← package helper
```

```go
// main.go
import "example.com/upstream/internal/helper"
```

```
$ go build ./...
main.go:3:8: use of internal package example.com/upstream/internal/helper not allowed
```

**Bug:** the team reasoned, "the source is right there in `vendor/`; surely we can import it." Wrong. `vendor/` is a *resolution mechanism*. The import path is still `example.com/upstream/internal/helper`. The parent of the `internal/` element in that path is `example.com/upstream`, not anywhere inside `myapp/`. The rule rejects.

**Fix:** vendoring does not promote internals. Same options as Bug 2: use the upstream's public API, fork it, or upstream-promote the helper.

The lesson: *seeing* a file in `vendor/` does not mean you may *import* it. The toolchain enforces the rule on the import path, not on filesystem reachability.

---

## Bug 4 — `internal` as a substring, not an element

```
project/
├── go.mod                          ← module example.com/project
├── main.go
└── internalstuff/
    └── tool.go                     ← package tool
```

```go
// main.go in another module:
import "example.com/project/internalstuff"
```

The team assumes the rule will protect `internalstuff/`. It does not.

```
$ go build ./...
$ # Build succeeds. internalstuff is importable from anywhere.
```

**Bug:** the rule matches `internal` as a *path element*, not a *substring*. `internalstuff/` is just a directory whose name happens to start with the letters "internal." It is fully public.

**Fix:** if you wanted protection, the directory must be named exactly `internal`:

```bash
git mv internalstuff internal/stuff
# update imports: example.com/project/internalstuff → example.com/project/internal/stuff
goimports -w .
```

The rule is strict about path-element equality. There is no fuzzy matching.

---

## Bug 5 — `Internal/` with a capital I

```
project/
├── go.mod
└── Internal/
    └── secret/
        └── secret.go
```

```go
// from a different module:
import "example.com/project/Internal/secret"
```

```
$ go build ./...
$ # Build succeeds. Capital-I "Internal" is not magical.
```

**Bug:** the directory was named `Internal` (capital I), perhaps by a contributor who did not know the rule is case-sensitive. The toolchain matches `internal` byte-for-byte; `Internal` is just an ordinary directory.

**Fix:**

```bash
git mv Internal internal
goimports -w .
```

Note: on case-insensitive filesystems (macOS by default, Windows), `git mv Internal internal` may misbehave. Do it in two steps:

```bash
git mv Internal _temp
git mv _temp internal
```

The rule will now apply.

---

## Bug 6 — Nested module shadows `internal/`

```
project/
├── go.mod                          ← module example.com/project
├── internal/
│   └── helper/
│       └── helper.go
└── tools/
    ├── go.mod                      ← module example.com/project/tools
    └── runner.go                   ← imports project/internal/helper
```

`tools/runner.go`:

```go
package main

import "example.com/project/internal/helper"

func main() { _ = helper.Do }
```

```
$ go build ./...
runner.go:3:8: use of internal package example.com/project/internal/helper not allowed
```

**Bug:** the team thought `tools/` was a sub-directory of `project/` and therefore "inside" the parent of `internal/`. But `tools/` has its own `go.mod`, making it a separate module. Modules, not directories, are the unit of the rule.

**Fix:** decide what you really want.

- **If `tools/` is supposed to be part of `project/`,** delete `tools/go.mod`. Now `tools/` is just a package in `project/`, and the rule allows the import.
- **If `tools/` should remain a separate module,** the helper must move out of `internal/` (becomes part of `project`'s public surface), or be duplicated in `tools/`.

```bash
# Option A: merge into one module
rm tools/go.mod
go mod tidy   # at project root
```

The rule respects module boundaries even when directory layout suggests otherwise.

---

## Bug 7 — `internal/` rule and a `go run` from outside

A developer runs:

```bash
$ pwd
/home/dev/some-other-place
$ go run /home/dev/project/internal/tool/main.go
package command-line-arguments
        imports example.com/project/internal/log:
        use of internal package example.com/project/internal/log not allowed
```

The internal `tool` imports `internal/log`. From inside the project, `go run ./internal/tool` works fine.

**Bug:** when you `go run` a single file by absolute path *from outside the project*, the toolchain treats the invocation as "command-line arguments" — not as code rooted at the parent of `internal/`. The internal imports inside the file are then rejected.

**Fix:** run from inside the project:

```bash
cd /home/dev/project
go run ./internal/tool
```

Or, more idiomatically, give the tool a real package and entry point under `cmd/`:

```
project/cmd/tool/main.go
```

Then `go run ./cmd/tool` always works regardless of working directory (relative to module root).

---

## Bug 8 — Naming a package `internal`

```
project/
└── internal/
    └── auth/
        └── auth.go
```

`auth.go`:

```go
package internal       // wrong

func Login() {}
```

A consumer:

```go
import "example.com/project/internal/auth"

func main() {
    internal.Login()    // confusing: "internal.Login" — what is "internal"?
}
```

The build succeeds, but the call site looks bizarre.

**Bug:** the developer named the *package* `internal`, mistaking the directory's magic name for the package's required name. The directory is `internal/auth/`; the package inside should be `auth`, not `internal`.

**Fix:**

```go
package auth        // correct
```

Import sites then use `auth.Login()`. Read naturally.

The `internal/` magic is in the *directory*, not the package declaration. Packages keep their normal descriptive names.

---

## Bug 9 — `internal/` after a module rename

The team renames their module from `example.com/old` to `example.com/new`:

```bash
go mod edit -module=example.com/new
sed -i '' 's|example.com/old|example.com/new|g' $(find . -name '*.go')
```

A few hours later:

```
$ go build ./...
ok  example.com/new/...
$ go test ./...
some-test.go:3:8: use of internal package example.com/new/feature/internal/parse not allowed
```

But this build was passing before the rename. What changed?

**Bug:** the sed accidentally rewrote import paths in tests that lived in *another* module that depended on the old name. After the rewrite, those tests now imported `example.com/new/feature/internal/parse` from outside the `example.com/new/` subtree — the module path moved, but the boundary moved with it, and the importing tests are now in the wrong subtree.

This sometimes happens with sub-modules in mono-repos: the rename touched both modules' source, and one of them (the consumer) was not supposed to be inside `example.com/new`.

**Fix:** find all places where the rename was inappropriate. Restore the originals:

```bash
git diff main -- ':!*.go'
git checkout main -- the-other-module/
```

Run the rename again, scoped to the right module:

```bash
sed -i '' 's|example.com/old|example.com/new|g' $(find . -path './the-right-module/*' -name '*.go')
```

Run the build and tests; the `internal/` rule should hold again.

---

## Bug 10 — Tests in a different module

```
project/
├── go.mod                          ← module example.com/project
├── internal/
│   └── auth/
│       └── auth.go
└── tests/
    ├── go.mod                      ← module example.com/project-tests  (separate!)
    └── auth_integration_test.go
```

`auth_integration_test.go`:

```go
package tests

import (
    "testing"

    "example.com/project/internal/auth"
)

func TestAuth(t *testing.T) {
    if !auth.Login("u", "p") {
        t.Fatal("login failed")
    }
}
```

```
$ go test ./...
auth_integration_test.go:6:5: use of internal package example.com/project/internal/auth not allowed
```

**Bug:** `tests/` has its own `go.mod`, making it a separate module. Even though it sits inside `project/` on disk, the toolchain treats it as foreign.

**Fix:** move integration tests into the main module:

```bash
rm tests/go.mod tests/go.sum
mv tests/auth_integration_test.go project/internal/auth/   # or keep them at project root
```

Or, if the tests must live in their own module, expose a public test fixture:

```go
// project/authtest/fixture.go (NOT under internal/)
package authtest

import "example.com/project/internal/auth"

func Login(u, p string) bool { return auth.Login(u, p) }
```

The integration tests in `tests/` then import `example.com/project/authtest`, which is public. Trade-off: now `authtest` is part of your contract.

---

## Bug 11 — Multi-level `internal/` blocking a legitimate caller

```
project/
├── go.mod
├── handler/
│   ├── handler.go
│   └── internal/
│       └── parse/
│           └── parse.go
└── service/
    └── service.go      ← needs parse for legitimate reasons
```

`service/service.go`:

```go
package service

import "example.com/project/handler/internal/parse"

func Process() { _ = parse.Header }
```

```
$ go build ./...
service/service.go:3:8: use of internal package example.com/project/handler/internal/parse not allowed
```

**Bug:** someone added `parse` under `handler/internal/` because "it is a parser used by handlers." But over time, `service` legitimately needs the same parser. The architectural decision now blocks a real call site.

**Fix:** the boundary is wrong. The package's true scope is "module-private," not "handler-private." Move it:

```bash
git mv handler/internal/parse internal/parse
goimports -w .
```

Now both `handler` and `service` may import. The original placement was a guess; usage taught you the correct scope.

The lesson: multi-level `internal/` is a *response* to observed leaks, not a preventive guess. When a legitimate caller is blocked, widen the boundary.

---

## Bug 12 — `internal/` in a published library after release

A library publishes `v1.0.0` with a public `helper` package. Three months in, the maintainer realises `helper` was an accident. They run:

```bash
git mv helper internal/helper
goimports -w .
git tag v1.1.0
```

A consumer:

```bash
$ go get example.com/lib@v1.1.0
$ go build ./...
main.go:3:8: use of internal package example.com/lib/internal/helper not allowed
```

The maintainer's CI still passed because they did not test against external consumers.

**Bug:** hiding a previously-public package is a *breaking change*. Consumers who depended on `helper` cannot upgrade without code changes. Calling it `v1.1.0` violates SemVer.

**Fix:** release a major version:

```bash
git revert v1.1.0
# update module path to /v2
go mod edit -module=example.com/lib/v2
# move helper back, then rebuild releases
git tag v2.0.0
```

In the v2 release notes, document: "Removed: the `helper` package, which was unintentionally exposed in v1. Equivalents are now under `internal/`. If you need the functionality, use the public `Library.Process` method instead."

If consumers are few, you can deprecate `helper` first (`Deprecated:` comment in v1.x, removal in v2). If consumers are many, the deprecation period should be longer.

The mechanical move is one keystroke; the social commitment is much larger.

---

## Bug 13 — `internal/` exposed via a returned type

```go
// project/api/api.go (PUBLIC)
package api

import "example.com/project/internal/foo"

func Get() *foo.Thing { return &foo.Thing{} }   // returns an internal type
```

A consumer:

```go
package main

import "example.com/project/api"

func main() {
    t := api.Get()      // works — t is of type *foo.Thing
    _ = t.Name           // works — Name is exported on Thing
    var x foo.Thing     // FAILS — cannot reference foo
}
```

```
$ go build ./...
main.go:7:7: use of internal package example.com/project/internal/foo not allowed
```

**Bug:** the public `api.Get` returns an *internal* type. The consumer can hold it, call exported methods on it, even pass it around — but cannot refer to the type by name. The library has accidentally exposed `Thing` as part of its API while keeping `foo` internal. Refactoring the type now breaks the consumer.

This is a leak of an internal type, even though the package is internal.

**Fix:** decide which side the type belongs on.

- **Option A: promote the type to public.** Move `Thing` (or a public mirror of it) into `api`:

  ```go
  package api

  type Thing struct {
      Name string
      // ...
  }

  func Get() *Thing { return &Thing{} }
  ```

- **Option B: return an interface, not a concrete type.** Define the interface in `api`:

  ```go
  package api

  type Thing interface {
      Name() string
  }

  func Get() Thing { /* return an internal type that satisfies Thing */ }
  ```

  The consumer talks to the interface; the concrete type stays internal.

The bug here is not a build failure — the build succeeds. The bug is in the API design. Be deliberate about what your public functions return.

---

## Bug 14 — `internal/` inside `go.work`

```
workspace/
├── go.work
├── modA/
│   ├── go.mod              ← module example.com/A
│   └── internal/
│       └── shared/
│           └── shared.go
└── modB/
    ├── go.mod              ← module example.com/B
    └── main.go
```

`modB/main.go`:

```go
package main

import "example.com/A/internal/shared"

func main() { _ = shared.Do }
```

```
$ go build ./...
main.go:3:8: use of internal package example.com/A/internal/shared not allowed
```

**Bug:** the developer thought `go.work` would relax the `internal/` rule because both modules are in the same workspace. It does not. Workspaces are a *build-time convenience* for local development; they do not merge modules.

**Fix:** workspaces do not change visibility. Use the same options as Bug 1: merge modules, promote the helper, or extract it into a third shared module.

```bash
# Most common fix in this case:
mkdir -p ../shared
mv modA/internal/shared/* ../shared/
cd ../shared && go mod init example.com/shared
# add ./shared to go.work
# update modA and modB to require example.com/shared
```

Workspace mode means "build these modules together"; it does not mean "treat them as one module."

---

## Bug 15 — `internal/` and `go.mod` in a fork

A team forks `example.com/upstream` to `example.com/myorg/upstream`. The fork retains the original directory structure, including `internal/`. They expect to be able to import the `internal/` packages from a *different* repo of theirs:

```go
// in example.com/myorg/consumer:
import "example.com/myorg/upstream/internal/helper"
```

```
$ go build ./...
main.go:3:8: use of internal package example.com/myorg/upstream/internal/helper not allowed
```

**Bug:** the fork lives at `example.com/myorg/upstream`. Its `internal/` boundary now sits at `example.com/myorg/upstream/`. The consumer (`example.com/myorg/consumer`) is not under that path. The rule rejects.

The fact that you own both the fork and the consumer does not matter to the toolchain. The rule is about path prefixes, not ownership.

**Fix:** treat your fork like any other module. If you need `helper` from the consumer:

- Promote it to public in your fork: `git mv internal/helper helper`. Now `helper` is part of your fork's public surface.
- Or vendor and inline: copy the helper into the consumer.
- Or restructure: move the consumer's relevant code *into* the fork, so it lives inside `example.com/myorg/upstream/`.

Forking does not unlock internals across repos.

---

## Bug 16 — `_test.go` outside the parent

```
project/
├── go.mod
├── internal/
│   └── service/
│       └── service.go
└── pkg/
    └── service_blackbox_test.go
```

`pkg/service_blackbox_test.go`:

```go
package pkg

import (
    "testing"

    "example.com/project/internal/service"
)

func TestService(t *testing.T) { _ = service.Do() }
```

```
$ go test ./...
service_blackbox_test.go:6:5: use of internal package example.com/project/internal/service not allowed
```

**Bug:** the test file is in `pkg/`, which *is* under `project/`, the parent of `internal/`. So why is it rejected?

It is *not* rejected. Re-read the error. The test build actually succeeds in this scenario. The bug here is that the developer expected the rule to fire — they were trying to confirm the rule by example, and got confused by an irrelevant variable in their setup (perhaps they had `pkg/go.mod` from an old experiment, making it a separate module).

If the build fails, the most common cause is a stray `pkg/go.mod` you forgot about. Check:

```bash
find . -name go.mod
```

If there is a second `go.mod` in `pkg/`, that is your bug. Delete it; the rule allows the import again.

---

## Bug 17 — Capitalised file in `internal/`

A team has:

```
project/
└── internal/
    └── auth/
        ├── Auth.go         ← capital filename
        └── auth.go
```

Both files are in `package auth`. On macOS (case-insensitive filesystem), `git` may treat them as the same file, leading to lost work. The build itself does not care about file names — only directory names matter for `internal/`.

**Bug:** unrelated to the `internal/` rule, but easy to confuse. File names in Go can have any case; only the *directory* `internal` is case-sensitively matched by the rule.

**Fix:** rename files to lowercase to avoid filesystem confusion:

```bash
git mv internal/auth/Auth.go internal/auth/auth_v2.go    # or whatever
```

Conventionally, Go files use lowercase-with-underscores names.

The rule's case-sensitivity is *only* about the directory name `internal`. File names are unaffected.

---

## Bug 18 — Forgetting `internal/` is a directory, not a file

```
project/
├── go.mod
└── auth.internal.go        ← "internal" file
```

The developer hopes the rule applies because the file name contains `internal`. It does not. The rule looks at *directory names in the import path*, not file names.

```go
// A consumer in a different module:
import "example.com/project"
// ...
project.Auth()    // works — auth.internal.go is just a file in the package
```

The build succeeds. There is no protection.

**Bug:** the developer confused file names with directory names. There is nothing magical about a file called `auth.internal.go` or even `internal.go` — only directories named exactly `internal`.

**Fix:** if you want to hide `Auth`, the package containing it must be in an `internal/` directory:

```bash
mkdir -p internal/auth
git mv auth.internal.go internal/auth/auth.go
# update package declaration if the original was `package project`
```

Now the rule applies.

---

## Bug 19 — Mistaking `internal/` for symbol-level visibility

A team writes:

```go
// internal/auth/auth.go
package auth

func Login(u, p string) bool { return true }
func internal_helper() {}    // tries to "mark" as internal with naming convention
```

Then they hide the underscore-named function from outside callers... except outside callers cannot import the package at all. The naming convention is redundant.

**Bug:** there is no convention in Go for "more internal than internal." The `internal/` directory is binary: importable by the parent's subtree, or not. Within the package, identifier capitalisation handles symbol-level visibility.

**Fix:** use lowercase identifiers for unexported, capitals for exported. There is no third tier.

```go
package auth

func Login(u, p string) bool { return true }   // exported (visible to callers in the parent's subtree)
func helper() {}                                // unexported (visible only inside this package)
```

Stop adding underscores or "internal" prefixes; they have no effect on visibility.

---

## Bug 20 — Non-Go tooling that ignores the rule

A custom build tool (Bazel rule, internal monorepo runner) compiles Go without going through `cmd/go`. Suddenly internal imports start succeeding from places they should not:

```
$ bazel build //consumer:main
INFO: Build completed successfully (consumer imports upstream/internal/helper).
```

Then:

```
$ go build ./...
main.go:3:8: use of internal package example.com/upstream/internal/helper not allowed
```

The custom tool was happy; the standard toolchain refuses.

**Bug:** the custom build system did not implement the `internal/` rule. Some forks of `rules_go` (or in-house Go rules) skip the check, either by oversight or to "speed up" builds.

**Fix:** the custom tool must implement the rule. The algorithm is short:

```python
def allowed(imported, importer):
    elems = imported.split('/')
    last = -1
    for i, e in enumerate(elems):
        if e == 'internal':
            last = i
    if last == -1:
        return True
    parent = '/'.join(elems[:last])
    return importer == parent or importer.startswith(parent + '/')
```

If the custom tool drifts from `cmd/go` semantics, every Go-aware engineer who reads the project will be surprised. Fix the build system rather than living with the discrepancy.

The rule is part of Go's contract. Any tool that compiles Go should enforce it.
