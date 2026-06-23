# Project Layout — Find the Bug

> Each scenario shows a real-world layout or import structure with a bug. Find it, explain it, fix it. Solutions follow each scenario.

---

## Bug 1 — Importing an `internal/` package from outside

You have two repositories:

```
# Repo A (module example.com/lib)
example.com/lib/
├── go.mod
└── internal/
    └── secret/
        └── secret.go     (package secret; func DoThing())
```

```
# Repo B (module example.com/app)
example.com/app/
├── go.mod
└── main.go
```

Repo B's `main.go`:

```go
package main

import "example.com/lib/internal/secret"

func main() {
    secret.DoThing()
}
```

Build fails:

```
package example.com/lib/internal/secret: cannot use package outside ".../lib"
```

**Find the bug.**

**Solution.**
The `internal/` rule forbids importing `example.com/lib/internal/secret` from any code not rooted at `example.com/lib`. Repo B is rooted at `example.com/app`, so the import is rejected by `go build`.

There is no flag or override. The fix is one of:
- Ask the maintainer of `example.com/lib` to expose the functionality outside `internal/` (e.g., move `secret/` to a top-level public package).
- Fork the library, move the package out of `internal/`, and depend on the fork via a `replace` directive.
- Reimplement what you need in your own repo.

The error message is intentional: `internal/` is a contract.

---

## Bug 2 — Two `main` functions in the same directory

```
cmd/server/
├── main.go        (package main; func main() { runHTTP() })
└── admin.go       (package main; func main() { runAdmin() })
```

```
$ go build ./cmd/server
./admin.go:5:6: main redeclared in this block
        ./main.go:5:6: other declaration of main
```

**Find the bug.**

**Solution.**
A directory is one package. A `package main` may have exactly one `func main()`. Two declarations of `main` in the same package are a compile error.

Fix: split into two directories.

```
cmd/
├── server/main.go    (one package main, one func main)
└── admin/main.go     (another package main, another func main)
```

Each directory builds into its own binary. They share code via `internal/`.

---

## Bug 3 — Test file in the wrong package

```
internal/store/
├── store.go            (package store)
└── store_test.go       (package storetest)
```

```
$ go test ./internal/store
package example.com/myapp/internal/store/storetest: ...
        no Go files in /path/to/internal/store
```

**Find the bug.**

**Solution.**
Go allows two `package` clauses in a test file's directory: `store` (white-box) and `store_test` (black-box). The test file uses `storetest` — a third value that does not match either.

Either rule applies: `package store` or `package store_test`. Anything else is rejected because the toolchain expects either the production package or the special `_test` form.

Fix: rename `package storetest` to `package store_test`.

---

## Bug 4 — `pkg/` and the missing `internal/`

```
mylib/
├── go.mod         (module example.com/mylib)
├── pkg/
│   └── client/
│       └── client.go
└── secret/        ← named "secret" but at the top level
    └── secret.go  (used by client.go internally)
```

A consumer downloads `example.com/mylib`. They should be able to import `example.com/mylib/pkg/client`. They should NOT be able to import `example.com/mylib/secret`. But:

```go
// in another repo
import "example.com/mylib/secret"   // this works
```

**Find the bug.**

**Solution.**
The `pkg/` directory is a *convention*, not a fence. The `secret/` directory at the module root is *fully public* unless renamed `internal/secret/`.

The author intended `secret/` to be private but did not use the only mechanism Go provides for enforcing privacy: putting it under `internal/`.

Fix: `git mv secret internal/secret`. Update internal imports of `example.com/mylib/secret` to `example.com/mylib/internal/secret`. The toolchain will now reject the external import.

---

## Bug 5 — Directory and package name mismatch

```
internal/auth/
└── login.go       (declares: package authentication)
```

Code in another package:

```go
import "example.com/myapp/internal/auth"

func main() {
    auth.Login(...)
}
```

```
./main.go:5:5: undefined: auth
```

**Find the bug.**

**Solution.**
The directory is `auth/`, but the file declares `package authentication`. The import path uses the *directory* (`auth`), but inside the importer's code, the package is referred to by its *declared name* (`authentication`).

The import works (the directory exists), but the symbol `auth.Login` does not — the package's name is `authentication`, so calls must say `authentication.Login`.

Fix: rename the package clause to `package auth` (matching the directory). This is the universal Go convention; deviating from it forces every importer to use an alias.

---

## Bug 6 — Cyclic imports between sibling packages

```
internal/
├── user/
│   └── user.go     (imports "example.com/myapp/internal/billing")
└── billing/
    └── billing.go  (imports "example.com/myapp/internal/user")
```

```
$ go build ./...
package example.com/myapp/internal/user
        imports example.com/myapp/internal/billing
        imports example.com/myapp/internal/user: import cycle not allowed
```

**Find the bug.**

**Solution.**
Two packages directly import each other. Go forbids import cycles entirely.

Three fixes, ranked by typical fit:
1. **Extract shared types** to a third package (`internal/domain/`). Both `user` and `billing` import from `domain`; neither imports the other.
2. **Define interfaces in the consumer.** If `user` only needs *something that has a Charge method*, `user` defines its own interface. `billing` does not need to be imported; the concrete `*billing.Service` is passed in by `main`.
3. **Merge** if the two packages are inherently coupled.

The right choice depends on the actual coupling. The wrong choice is to leave the cycle and reach for `// nolint` — Go does not let you.

---

## Bug 7 — `cmd/server` importing `cmd/cli`

```
cmd/
├── server/main.go     (imports "example.com/myapp/cmd/cli")
└── cli/main.go
```

```
$ go build ./cmd/server
package example.com/myapp/cmd/cli is a main package, cannot be imported
```

**Find the bug.**

**Solution.**
A `package main` cannot be imported. `cmd/cli` is a binary, not a library. To share code between binaries, move the shared logic to `internal/`:

```
cmd/
├── server/main.go     (imports "example.com/myapp/internal/app")
└── cli/main.go        (imports "example.com/myapp/internal/app")
internal/
└── app/
    └── ...            (shared logic)
```

Each `cmd/<bin>/main.go` is a thin wrapper. Real logic lives in `internal/`.

---

## Bug 8 — Tests in a separate `tests/` folder

```
internal/store/
└── store.go      (package store; func Get(id int) (*User, error))

tests/
└── store_test.go (package store; tests for Get)
```

```
$ go test ./tests
./store_test.go:6:5: undefined: store.Get
```

**Find the bug.**

**Solution.**
Go tests live next to the code they test. The `tests/` directory at the top level is not a package the toolchain knows about; it is a separate package whose import path is `example.com/myapp/tests` and whose declared name conflicts with the production `store` package's name.

Fix: move `store_test.go` to `internal/store/`. It can be `package store` (white-box) or `package store_test` (black-box) — both work as long as the file is *next to* `store.go`.

There is no `tests/` convention in Go. Resist importing one from other languages.

---

## Bug 9 — `go.mod` rename without import update

You renamed your module:

```
# Before
module example.com/myapp

# After (in go.mod)
module github.com/me/myapp
```

You forgot to update imports inside the project:

```go
// internal/store/store.go
package store

import "example.com/myapp/internal/domain"   // OLD path
```

```
$ go build ./...
package example.com/myapp/internal/domain: no required module provides package
```

**Find the bug.**

**Solution.**
Renaming the module does not auto-update imports inside the source. Every internal `import "..."` that uses the old prefix must be rewritten to the new prefix.

Fix: search-and-replace, or use `gopls rename` to do it safely.

```bash
find . -name '*.go' -exec sed -i '' 's|example.com/myapp/|github.com/me/myapp/|g' {} +
```

Then `go mod tidy` and `go build ./...` to verify.

---

## Bug 10 — `internal/` placed too deep

```
myapp/
├── cmd/server/main.go   (imports "example.com/myapp/billing/internal/store")
└── billing/
    ├── billing.go
    └── internal/
        └── store/
            └── store.go
```

```
$ go build ./cmd/server
package example.com/myapp/billing/internal/store: cannot use package outside ".../billing"
```

**Find the bug.**

**Solution.**
`internal/store` is under `billing/`, so its allowed importers are limited to `myapp/billing/...`. The `cmd/server/main.go` is at `myapp/cmd/server/`, which is *not* a descendant of `myapp/billing/`. The import is rejected.

The author wanted `internal/store` to be private to billing but accessible from `cmd/server`. These goals are inconsistent. Fix one of:
- **If `cmd/server` should access it:** move `store/` higher up, e.g., to `myapp/internal/billing/store/`. Now anything under `myapp/...` can import it.
- **If `cmd/server` should not access it:** route through `billing.SomeFunction()` instead of importing `billing/internal/store` directly. The package layer is the public API; the internal package is an implementation detail.

This kind of bug is common when teams nest `internal/` for isolation and forget that the shell binaries live outside the isolated subtree.

---

## Bug 11 — `vendor/` and a missing module

```
myapp/
├── go.mod
├── vendor/
│   ├── modules.txt
│   └── github.com/foo/bar/...
└── main.go      (imports "github.com/baz/qux")
```

`go.mod` requires both `github.com/foo/bar` and `github.com/baz/qux`. Only `foo/bar` is in `vendor/`.

```
$ go build ./...
go: inconsistent vendoring in /path/to/myapp:
        github.com/baz/qux@v1.2.3: is explicitly required in go.mod, but not marked as explicit in vendor/modules.txt
```

**Find the bug.**

**Solution.**
With `vendor/` present and `go 1.14+`, the toolchain enters vendor mode and demands that `vendor/modules.txt` be consistent with `go.mod`. Adding a `require` to `go.mod` without re-running `go mod vendor` leaves vendor inconsistent.

Fix: `go mod vendor`. This regenerates `vendor/` and `vendor/modules.txt` to reflect the current `go.mod`.

The principle: every change to `go.mod` requires `go mod vendor` if you ship `vendor/`. CI should fail if `vendor/` is out of sync (e.g., run `go mod vendor && git diff --exit-code`).

---

## Bug 12 — A `_test.go` file accidentally compiled into production

```
internal/store/
├── store.go
└── store_helpers_test.go   (declares: package store; var TestHelper = ...)
```

`main.go` imports the package:

```go
import "example.com/myapp/internal/store"

func main() {
    fmt.Println(store.TestHelper)
}
```

```
./main.go:6:13: undefined: store.TestHelper
```

**Find the bug.**

**Solution.**
Files with the `_test.go` suffix are *only* compiled during `go test`. They are invisible to `go build` and to packages importing the production code.

The author wanted `TestHelper` available at runtime. Either:
- Rename the file to drop `_test.go` (`store_helpers.go`). Then it is part of the production package.
- Move the helper into a non-test file.

If the helper is genuinely test-only, do not export it from production code. Make it a test fixture inside `_test.go` files of the consuming tests, or build it into `internal/storetest/` (a package whose name signals "for tests of stuff using `store`").

---

## Bug 13 — Workspace mode breaking CI

Local development works:

```
acme/
├── go.work
├── shared/  (module github.com/acme/shared)
└── service/ (module github.com/acme/service; requires github.com/acme/shared v0.0.0)
```

`go.work` has both modules listed. Locally, edits to `shared/` are reflected in `service/` immediately. But CI fails:

```
$ go build ./...
go: github.com/acme/shared@v0.0.0: invalid version: ...
```

**Find the bug.**

**Solution.**
`service/go.mod` requires `github.com/acme/shared v0.0.0`, which does not exist as a real release. Locally, the workspace overrides the require: it points to the on-disk `shared/` directory. In CI, the workspace may or may not be active, and even if it is, the require version is meaningless.

Two fixes:
1. **CI uses the workspace.** Run `go build` from the workspace root (`acme/`), not from inside `service/`. The workspace is then active and the on-disk source is used.
2. **CI builds modules independently.** `cd service && GOWORK=off go build ./...`. But then `service/go.mod` must require a real published version of `shared`. Either tag and release `shared`, or use a `replace` directive in `service/go.mod` to point at a relative path.

The cleanest setup: commit `go.work` for development, run all CI from the workspace root with `go build ./...`, and require real versions in each `go.mod` for the rare case someone builds outside the workspace.

---

## Bug 14 — `pkg/internal/`

```
mylib/
├── pkg/
│   └── client/
│       ├── client.go   (depends on:)
│       └── internal/
│           └── helper/
│               └── helper.go
```

A user imports `example.com/mylib/pkg/client/internal/helper` from their own module:

```
package example.com/mylib/pkg/client/internal/helper: cannot use package outside ".../client"
```

That is *intended*. But then `pkg/client/client.go` imports `pkg/client/internal/helper` and *that* works. So far so good. The bug is structural.

**Find the bug.**

**Solution.**
`pkg/internal/...` is a strange combination. `pkg/` says "this is public." `internal/` says "this is private." Putting them together signals confusion about the package's purpose:

- If `helper` is private to `client`, why is `client` itself under `pkg/`? `pkg/` adds a level of "public-feeling" that `internal/helper` undermines.
- If `client` is public but `helper` is its private implementation, that is a normal library shape — but the `pkg/` prefix is just noise.

Cleaner shapes:
- Drop `pkg/` entirely. `client/` lives at the module root; `client/internal/helper/` is private to `client`. The module's public API is `client`.
- Or move `client` to `internal/client/` if it should not be public at all.

`pkg/internal/...` is a weak smell. Worth a refactor when you see it.

---

## Bug 15 — `init()` ordering surprise

```
internal/db/
├── pool.go      (sets up a global *sql.DB in init)
└── ...

cmd/server/
└── main.go      (imports nothing from internal/db, but transitively does via internal/store)
```

`main.go` calls `store.Get(1)` and the global `*sql.DB` is `nil`.

```
panic: runtime error: invalid memory address or nil pointer dereference
```

**Find the bug.**

**Solution.**
Two layout-related issues:
1. **Global state initialized in `init()` is fragile.** `init()` runs once per package, when the package is first imported. The order between sibling packages is *deterministic but not always intuitive* — Go runs `init()` in the order of dependency: a package's deps are initialized first.
2. **The `pool.go` `init()` may be running before its config is set up,** because the configuration code is in *another* package that has not been initialized yet. Or it may be running, but assigning a value that is later cleared.

Cleaner layout: do *not* use `init()` for resource setup. Add a constructor:

```go
// internal/db/db.go
package db

func New(cfg Config) (*DB, error) { /* ... */ }
```

Call it from `main()`:

```go
// cmd/server/main.go
db, err := db.New(cfg)
// pass db explicitly to whoever needs it
```

Layout principle: avoid global state initialized via `init()` across multiple packages. Make construction explicit. The compiler does not enforce this, but the layout reads cleaner without it.

---

## Bug 16 — Renaming a package, missing one importer

You renamed `internal/store` to `internal/persistence`. Most files updated. One was missed:

```
$ go build ./...
package example.com/myapp/internal/store: no required module provides package
```

You search:

```
$ grep -r "example.com/myapp/internal/store" .
./scripts/codegen/render.go:7: import "example.com/myapp/internal/store"
```

You missed it because `scripts/codegen/` was outside your usual `find` scope.

**Find the bug.**

**Solution.**
The bug is procedural, not technical. Renames in Go must be exhaustive — every import statement must be updated.

Fix: update the missed file. Also, for next time: prefer `gopls rename` (which uses Go's import graph and updates every file regardless of where it lives) over `find` + `sed` (which depends on you remembering every directory).

```
$ go run -mod=mod golang.org/x/tools/gopls rename \
    -d -i ./internal/store internal/persistence
```

Layout takeaway: when you have non-source-but-importing-source directories (`scripts/codegen/`, build helpers in Go, etc.), include them in your refactor checklist. They are easy to miss.

---

## Bug 17 — `_examples/` becoming a build target

You have:

```
mylib/
├── go.mod
├── client.go
└── _examples/
    ├── basic/main.go
    └── advanced/main.go
```

CI runs `go vet ./...` and you expect it to skip `_examples/`. It does. But `go test ./_examples/...` reports:

```
matched no packages
```

You then commit a CI step that does `cd _examples/basic && go run main.go`. It fails:

```
go: cannot find main module
```

**Find the bug.**

**Solution.**
Two issues conflated:
1. `_examples/` (with leading underscore) is *invisible* to Go's package discovery. `./...` wildcards never match it. This is a feature: it lets you keep example code in the repo without including it in builds.
2. To run an example, you cannot just `go run main.go` — the directory is not a Go module on its own (it has no `go.mod`), and the parent's `go.mod` excludes the underscore directory from package discovery, but `go run main.go` still wants to know which module it belongs to.

Fix: either rename `_examples/` to `examples/` (then `./examples/...` is matched and `go run ./examples/basic` works), or give each example its own `go.mod` so they are independent modules.

The convention: leading-underscore directories are for code you want to keep but not build. If you want to build them, lose the underscore.

---

## Bug 18 — Layout that hides an import cycle until late

```
internal/
├── domain/          (declares User, Order, Invoice)
├── store/           (imports domain; provides UserRepo)
├── http/            (imports domain and store; HTTP handlers)
└── app/             (imports domain, store, and http)
```

A new feature is added: a webhook that triggers some HTTP code from inside `store` (push notification on save):

```go
// internal/store/user.go
import "example.com/myapp/internal/http"

func (r *UserRepo) Save(u *User) error {
    // ...
    http.NotifyWebhook(...)
    return nil
}
```

```
$ go build ./...
package example.com/myapp/internal/http
        imports example.com/myapp/internal/store
        imports example.com/myapp/internal/http: import cycle not allowed
```

**Find the bug.**

**Solution.**
The new import inverts the layered dependency: `store` is a lower layer, `http` is upper. A lower layer importing an upper layer always risks a cycle, and here it produced one.

Fix: define an interface in `store` that *some other package* satisfies. The webhook caller passes itself in.

```go
// internal/store/user.go
type Notifier interface {
    NotifyWebhook(event Event) error
}

type UserRepo struct {
    db       *DB
    notifier Notifier   // passed in by main()
}

func (r *UserRepo) Save(u *User) error {
    // ...
    if r.notifier != nil { r.notifier.NotifyWebhook(...) }
    return nil
}
```

`main()` constructs an `*http.WebhookNotifier` and hands it to `store.NewUserRepo(...)`. Now `store` imports nothing from `http`; `http` provides a type that satisfies `store.Notifier`.

This is dependency inversion as a layout fix. The architectural rule "lower layers do not import upper layers" remains; the cycle is broken.
