# Package Import Rules — Find the Bug

> Each snippet contains a real-world bug related to Go's package import rules. Find it, explain it, fix it.

---

## Bug 1 — Cyclic import between two packages

```go
// file: pkg/order/order.go
package order

import "github.com/me/shop/pkg/customer"

type Order struct {
    Buyer customer.Customer
    Items []string
}
```

```go
// file: pkg/customer/customer.go
package customer

import "github.com/me/shop/pkg/order"

type Customer struct {
    Name    string
    History []order.Order
}
```

```bash
$ go build ./...
package github.com/me/shop/pkg/order
        imports github.com/me/shop/pkg/customer
        imports github.com/me/shop/pkg/order: import cycle not allowed
```

**Bug:** `order` imports `customer` to embed `Customer`, and `customer` imports `order` to keep a slice of past orders. The compiler refuses any A→B→A cycle, full stop. Go has no forward declarations and no header files; cycles are a design smell, not just a syntactic one.

**Fix:** break the cycle by extracting a third package or by depending on an interface instead of a concrete type. The cleanest move: put the shared "order history" type in its own package, or invert the relationship so only one side knows the other:

```go
// file: pkg/customer/customer.go
package customer

type Customer struct {
    ID   string
    Name string
}
```

```go
// file: pkg/order/order.go
package order

import "github.com/me/shop/pkg/customer"

type Order struct {
    Buyer customer.Customer
    Items []string
}
```

The history of past orders for a buyer becomes a query (`order.HistoryFor(custID)`), not a field on `Customer`. No cycle.

---

## Bug 2 — Importing an unexported identifier

```go
// file: pkg/auth/auth.go
package auth

func hashPassword(p string) string { /* ... */ return "" }
```

```go
// file: cmd/server/main.go
package main

import "github.com/me/app/pkg/auth"

func main() {
    h := auth.hashPassword("hunter2")
    _ = h
}
```

```bash
$ go build ./...
cmd/server/main.go:6:11: cannot refer to unexported name auth.hashPassword
```

**Bug:** Identifiers that start with a lowercase letter are package-private. They can only be referenced from inside the same package. There is no `friend`, no `protected`, no `internal` keyword — capitalisation *is* the visibility modifier.

**Fix:** if `hashPassword` is genuinely meant to be the public API, rename it. If it should stay private, expose a wrapper that does the right thing:

```go
// file: pkg/auth/auth.go
package auth

func HashPassword(p string) string { return hashPassword(p) }

func hashPassword(p string) string { /* ... */ return "" }
```

Now `auth.HashPassword(...)` works from outside the package.

---

## Bug 3 — The same path imported twice

```go
package main

import (
    "fmt"
    "net/http"

    "fmt"
)

func main() {
    fmt.Println("hi")
    _ = http.StatusOK
}
```

```bash
$ go build
./main.go:7:5: fmt redeclared in this block
        ./main.go:4:5: other declaration of fmt
```

**Bug:** A path must appear at most once in an import block (unless one of the duplicates uses an alias). A copy-paste merge or a hand-edited diff often produces this.

**Fix:** delete the duplicate. If you really need two views of the same package, alias one:

```go
import (
    "fmt"

    altfmt "fmt"
)
```

But there is almost never a reason to do that — the dedup is the right call.

---

## Bug 4 — Import alias collides with a local variable

```go
package main

import (
    "fmt"

    log "log/slog"
)

func main() {
    log := "starting up"
    fmt.Println(log)
    log.Info("started")   // ???
}
```

```bash
$ go build
./main.go:11:6: log.Info undefined (type string has no field or method Info)
```

**Bug:** The local variable `log := "starting up"` shadows the imported package alias `log`. Inside `main`, the identifier `log` now resolves to a `string`, not the slog package.

**Fix:** rename either the alias or the variable. Idiomatic Go uses the package name as the alias:

```go
import (
    "fmt"
    "log/slog"
)

func main() {
    msg := "starting up"
    fmt.Println(msg)
    slog.Info("started")
}
```

If you really want the short name `log`, pick a different identifier for the message.

---

## Bug 5 — Blank import that no longer registers anything

```go
package main

import (
    "database/sql"

    _ "github.com/lib/pq"
)

func main() {
    db, err := sql.Open("postgres", "...")
    _, _ = db, err
}
```

A teammate later cleans up `github.com/lib/pq`'s `init()` (or upgrades to a major version that drops the side-effect):

```go
// in github.com/lib/pq v2 (hypothetical)
package pq
// init() removed; users must call pq.Register() explicitly now
```

```bash
$ ./server
sql: unknown driver "postgres" (forgotten import?)
```

**Bug:** A blank import (`_ "path"`) only runs the imported package's `init()` functions. If those side effects are removed (or never existed), the blank import becomes silently useless. The `database/sql` driver registry stays empty and `sql.Open("postgres", ...)` returns "unknown driver".

**Fix:** prefer explicit registration when a library supports it, and write a smoke test that asserts the driver is present:

```go
import "github.com/lib/pq"

func init() { pq.Register() }
```

```go
func TestDriverRegistered(t *testing.T) {
    found := false
    for _, name := range sql.Drivers() {
        if name == "postgres" { found = true; break }
    }
    if !found { t.Fatal("postgres driver not registered") }
}
```

---

## Bug 6 — Dot import shadows a stdlib name

```go
package main

import (
    "fmt"

    . "github.com/me/app/pkg/strings"   // local helper package
)

func main() {
    fmt.Println(ToUpper("hello"))
}
```

```go
// file: pkg/strings/strings.go
package strings

func ToUpper(s string) string { return "<<UPPERCASE>>" + s }
```

Later, somebody adds:

```go
import (
    "fmt"
    "strings"
    . "github.com/me/app/pkg/strings"
)

func main() {
    fmt.Println(strings.ToUpper("hello"))
}
```

```bash
$ go build
./main.go:5:2: strings redeclared in this block
```

**Bug:** Dot imports (`.`) merge another package's exported names into the current scope. The moment any other identifier — including a stdlib import — collides, the file refuses to compile. Even when there is no syntactic clash, dot imports make every unqualified call ambiguous to the reader.

**Fix:** avoid dot imports outside of test DSLs (Ginkgo, gomega). Use a normal import or a short alias:

```go
import (
    "fmt"
    "strings"

    mystr "github.com/me/app/pkg/strings"
)

func main() {
    fmt.Println(mystr.ToUpper("hello"))
}
```

---

## Bug 7 — Crossing an `internal/` boundary from another module

```go
// in module github.com/acme/api
// file: internal/secret/secret.go
package secret

const APIKey = "sk-live-..."
```

```go
// in module github.com/me/myapp
// file: main.go
package main

import "github.com/acme/api/internal/secret"

func main() { _ = secret.APIKey }
```

```bash
$ go build
main.go:3:8: use of internal package github.com/acme/api/internal/secret not allowed
```

**Bug:** Any path containing `internal/` is only importable by packages rooted in the parent of that `internal/` directory *and within the same module*. From a different module, the import is forbidden — by design.

**Fix:** if the symbol is meant to be public, move it out of `internal/`. If it is genuinely private, you cannot import it; either fork the upstream module, ask the maintainer for a public API, or copy the value:

```go
// upstream — promote to public
// file: secret/secret.go (no longer under internal/)
package secret
const APIKey = "..."
```

Then consumers can `import "github.com/acme/api/secret"`.

---

## Bug 8 — Underscore in folder name vs the actual package name

```bash
$ ls pkg/
http_utils/
```

```go
// file: pkg/http_utils/utils.go
package http_utils

func Join(a, b string) string { return a + "/" + b }
```

```go
// file: cmd/server/main.go
package main

import "github.com/me/app/pkg/http_utils"

func main() { _ = httputils.Join("a", "b") }
```

```bash
$ go build
cmd/server/main.go:6:11: undefined: httputils
```

**Bug:** The folder name contains an underscore, so the *import path* contains an underscore too. The author then wrote `httputils.Join(...)` (no underscore) assuming the underscore was just a folder convention. It is not — the package name in source is what determines the qualifier, and it is `http_utils`.

Worse: `go vet` and reviewers all complain about the underscore. Go style guide forbids underscores in package names.

**Fix:** rename the folder *and* the package clause to a single word:

```bash
$ git mv pkg/http_utils pkg/httputils
```

```go
// file: pkg/httputils/utils.go
package httputils
```

```go
import "github.com/me/app/pkg/httputils"
// ...
httputils.Join("a", "b")
```

---

## Bug 9 — Wrong-cased import path on a case-sensitive filesystem

```go
import "github.com/Sirupsen/logrus"
```

Locally on macOS:

```bash
$ go build
# works
```

In CI on Linux:

```bash
$ go build
build github.com/me/app: cannot find module providing package
github.com/Sirupsen/logrus
```

**Bug:** macOS uses a case-insensitive filesystem by default, so both `Sirupsen` and `sirupsen` resolve to the same directory in the module cache. Linux is case-sensitive — only the canonical lowercase path works. The repo was renamed years ago; the old casing only "works" on Mac.

**Fix:** rewrite the import to the canonical path and run `go mod tidy`:

```go
import "github.com/sirupsen/logrus"
```

```bash
$ go mod tidy
$ git diff go.mod go.sum
```

Add a CI step on Linux to catch this class of bug early.

---

## Bug 10 — Ambiguous import across two majors

```go.mod
require (
    github.com/foo/bar v1.5.0
    github.com/foo/bar/v2 v2.1.0
)
```

```go
import "github.com/foo/bar"
// later in the same file
import bar2 "github.com/foo/bar/v2"
```

A reviewer simplifies things:

```go
import "github.com/foo/bar"

func main() {
    x := bar.NewClient()
    x.NewMethodIntroducedInV2()   // !!
}
```

```bash
$ go build
./main.go:6:7: x.NewMethodIntroducedInV2 undefined
```

**Bug:** `github.com/foo/bar` and `github.com/foo/bar/v2` are *different modules*. Importing the v1 path gives you v1 types, even if v2 is in `go.mod`. Consumers often confuse "I have v2 in my go.mod" with "all my code uses v2".

**Fix:** decide on a single major across the project. If you need both for migration, use distinct aliases consistently, and write tests that assert which methods you call. Otherwise, drop one major and delete the unused require:

```go
import "github.com/foo/bar/v2"

func main() {
    x := bar.NewClient()
    x.NewMethodIntroducedInV2()
}
```

```bash
$ go mod tidy   # removes unused v1
```

---

## Bug 11 — Build tag mismatch hides an import

```go
// file: pkg/sysinfo/sysinfo_linux.go
//go:build linux

package sysinfo

import "syscall"

func PageSize() int { return syscall.Getpagesize() }
```

```go
// file: pkg/sysinfo/sysinfo.go
package sysinfo

func PageSize() int { return 4096 }
```

A teammate adds Darwin support but mistypes the tag:

```go
// file: pkg/sysinfo/sysinfo_darwin.go
//go:build darvin

package sysinfo

import "syscall"

func PageSize() int { return syscall.Getpagesize() }
```

```bash
$ GOOS=darwin go build ./...
pkg/sysinfo/sysinfo.go:3:6: PageSize redeclared in this block
        pkg/sysinfo/sysinfo_darwin.go:5:6: other declaration of PageSize
```

Or, on Linux:

```bash
$ go build ./...
./sysinfo_darwin.go:5:6: imported and not used: "syscall"
```

**Bug:** `darvin` is a typo for `darwin`. The build constraint never matches, so the file is included unconditionally, colliding with the fallback. (Or, depending on the `_GOOS` filename suffix, the file is filtered out and the import vanishes.)

**Fix:** use `go vet` and check tags carefully. Constraints must be valid GOOS/GOARCH tokens or whitelisted values:

```go
//go:build darwin
```

```bash
$ go vet ./...
$ GOOS=darwin go build ./...
$ GOOS=linux  go build ./...
```

CI should run both `GOOS=linux` and `GOOS=darwin` builds for code that uses tags.

---

## Bug 12 — Missing `package` clause produces a confusing error

```go
// file: pkg/util/util.go
import "fmt"

func Hello() { fmt.Println("hi") }
```

```bash
$ go build ./pkg/util
pkg/util/util.go:1:1: expected 'package', found 'import'
```

```bash
$ go build ./...
package github.com/me/app/pkg/util: expected 'package', found 'import'
```

**Bug:** The very first non-comment, non-blank line of every Go source file must be `package <name>`. Forgetting it gives a parser error that points at the import line, which mislead a junior engineer into "deleting" the import — and breaking the file further.

**Fix:** add the package clause:

```go
package util

import "fmt"

func Hello() { fmt.Println("hi") }
```

A linter (`gofmt`, `goimports`, or `golangci-lint` with `unused`) will not even run on a file without `package` — fix that first, always.

---

## Bug 13 — `package foo_test` cannot reach unexported fields

```go
// file: pkg/cache/cache.go
package cache

type Cache struct {
    items map[string]string
}

func New() *Cache { return &Cache{items: map[string]string{}} }
func (c *Cache) Set(k, v string) { c.items[k] = v }
```

```go
// file: pkg/cache/cache_test.go
package cache_test

import (
    "testing"

    "github.com/me/app/pkg/cache"
)

func TestSet(t *testing.T) {
    c := cache.New()
    c.Set("k", "v")
    if c.items["k"] != "v" {           // !!
        t.Fatal("not set")
    }
}
```

```bash
$ go test ./pkg/cache
./cache_test.go:13:8: c.items undefined (cannot refer to unexported field
or method items of struct cache.Cache)
```

**Bug:** A file with `package foo_test` is in a *different* package (the "external test" pattern). It only sees the exported API. Reaching into `c.items` is a clue that the test wants to be in `package foo` (white-box).

**Fix:** decide intentionally. White-box test → use `package cache`:

```go
package cache

func TestSet(t *testing.T) { /* can see c.items */ }
```

Or keep `package cache_test` and test through the public API:

```go
func TestSet(t *testing.T) {
    c := cache.New()
    c.Set("k", "v")
    if got := c.Get("k"); got != "v" { t.Fatalf("got %q", got) }
}
```

(Black-box tests are usually preferable; they keep the public API honest.)

---

## Bug 14 — Init order broken by file rename

```go
// file: pkg/conf/a_defaults.go
package conf

var Settings = map[string]string{}

func init() { Settings["env"] = "dev" }
```

```go
// file: pkg/conf/b_overrides.go
package conf

func init() { Settings["env"] = "prod" }   // overrides a_defaults
```

A teammate renames `b_overrides.go` → `0_overrides.go` to "make it sort first":

```bash
$ go test ./pkg/conf
got env=dev, want env=prod
```

**Bug:** Within a single package, `init()` functions run *in the order the compiler processes files*, which is alphabetical by filename. The author renamed `b_overrides.go` (runs after `a_defaults.go`) to `0_overrides.go` (runs *before* it). Now defaults overwrite overrides.

**Fix:** never rely on alphabetical filename order for `init()` correctness. It is a brittle contract. Replace it with explicit code:

```go
// file: pkg/conf/conf.go
package conf

var Settings = map[string]string{
    "env": "dev",
}

func init() {
    if os.Getenv("ENV") == "prod" {
        Settings["env"] = "prod"
    }
}
```

If you truly need ordered initialisation, do it from a single `init()` that calls helpers in the right order.

---

## Bug 15 — Side-effect import placed too late

```go
package main

import (
    "database/sql"
    "fmt"
    "log"
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil { log.Fatal(err) }
    fmt.Println(db.Ping())
}

import _ "github.com/lib/pq"   // mistakenly added at bottom
```

```bash
$ go build
./main.go:14:1: imports must appear before other declarations
```

**Bug:** All imports must be in a single `import` block (or sequence of import declarations) at the top of the file, after `package` and before any other declaration. Some IDE quick-fixes append imports at the bottom — Go rejects this outright.

**Fix:** move the side-effect import into the main import block:

```go
package main

import (
    "database/sql"
    "fmt"
    "log"

    _ "github.com/lib/pq"
)
```

`gofmt`/`goimports` will fix this automatically; run them on save.

---

## Bug 16 — Vendored deps but `-mod=mod` set

```bash
$ ls
go.mod  go.sum  vendor/  cmd/  ...
$ go env GOFLAGS
-mod=mod
$ go build ./...
go: finding module for package github.com/spf13/cobra
go: downloading github.com/spf13/cobra v1.8.0
... (downloading from network instead of using vendor/)
```

**Bug:** When a `vendor/` directory exists, the default mode is `-mod=vendor`. Someone set `GOFLAGS=-mod=mod` globally, which bypasses the vendor tree and re-fetches everything from the proxy. CI builds become non-deterministic; air-gapped builds fail entirely.

**Fix:** unset the flag (or set it to `vendor` explicitly):

```bash
$ go env -u GOFLAGS
# or
$ go env -w GOFLAGS=-mod=vendor
```

Verify:

```bash
$ go build -v ./... 2>&1 | head
# should NOT contain "downloading"
```

Document the build mode in `Makefile`:

```makefile
build:
	go build -mod=vendor ./...
```

---

## Bug 17 — Package name in source ≠ folder name

```bash
$ ls pkg/
util/
```

```go
// file: pkg/util/util.go
package helpers   // !!

func Hello() string { return "hi" }
```

```go
// file: cmd/server/main.go
package main

import "github.com/me/app/pkg/util"

func main() { fmt.Println(util.Hello()) }
```

```bash
$ go build ./...
cmd/server/main.go:6:11: undefined: util
```

**Bug:** The import path is `.../pkg/util`, but inside the file the `package` clause says `helpers`. The default qualifier in consumers is the *package name*, not the last path segment. So `util.Hello()` is wrong; it would have to be `helpers.Hello()`.

This is legal Go but a giant footgun. Tools warn about it (`go vet`, `golangci-lint`'s `revive` rule).

**Fix:** keep the package name and folder name aligned. Either rename the package:

```go
package util
```

Or rename the folder:

```bash
$ git mv pkg/util pkg/helpers
```

If you really must diverge (e.g. `package main` in a `cmd/server/` folder), explicitly alias on import — but for libraries, just match the names.

---

## Bug 18 — Conditionally compiled-out import

```go
// file: net.go
//go:build linux

package net

import "github.com/vishvananda/netlink"

func List() ([]string, error) {
    links, err := netlink.LinkList()
    _ = links
    return nil, err
}
```

```go
// file: net_other.go
//go:build !linux

package net

func List() ([]string, error) { return nil, nil }
```

A teammate, on macOS:

```bash
$ go build ./...
$ go mod tidy
go: removing github.com/vishvananda/netlink v1.x.x
```

Then on Linux:

```bash
$ go build ./...
net.go:5:8: no required module provides package
github.com/vishvananda/netlink
```

**Bug:** `go mod tidy` only inspects packages reachable under the *current* `GOOS`/`GOARCH`. On macOS, `net.go` is excluded by the build tag; tidy thinks `netlink` is unused and removes it. The Linux build then fails because the require is gone.

**Fix:** run `go mod tidy` against the *union* of supported platforms. Modern Go has a flag for this:

```bash
$ go mod tidy -compat=1.22
```

Better yet, run tidy in CI with `GOOS=linux` *and* `GOOS=darwin`, and fail if `go.mod` would change:

```bash
$ GOOS=linux  go mod tidy
$ GOOS=darwin go mod tidy
$ git diff --exit-code go.mod go.sum
```

Or use the official solution: declare an `//go:build ignore` file that imports every conditional dep so tidy keeps them.

---

## Bug 19 — Indirect cycle through a type alias

```go
// file: pkg/a/a.go
package a

import "github.com/me/app/pkg/b"

type Handler = b.Handler   // alias
```

```go
// file: pkg/b/b.go
package b

import "github.com/me/app/pkg/a"

type Handler struct {
    Next a.Handler   // uses the alias
}
```

```bash
$ go build ./...
package github.com/me/app/pkg/a
        imports github.com/me/app/pkg/b
        imports github.com/me/app/pkg/a: import cycle not allowed
```

**Bug:** Type aliases (`type X = Y`) do not weaken the import graph. The compiler still has to resolve `b.Handler` while compiling `a`, and `a.Handler` while compiling `b`. The cycle is real even though it looks like "just" an alias.

**Fix:** put the shared type in a third package that both depend on:

```go
// file: pkg/handler/handler.go
package handler

type Handler interface { ServeHTTP() }
```

```go
// file: pkg/a/a.go
package a

import "github.com/me/app/pkg/handler"
type Handler = handler.Handler
```

```go
// file: pkg/b/b.go
package b

import "github.com/me/app/pkg/handler"
type Wrapper struct { Next handler.Handler }
```

`a` and `b` no longer reference each other.

---

## Bug 20 — `goimports` removes a build-tag-only import

```go
// file: net_linux.go
//go:build linux

package main

import (
    "fmt"

    "github.com/vishvananda/netlink"
)

func showLinks() { fmt.Println(netlink.LinkList()) }
```

A teammate on macOS hits "format on save" — their editor runs `goimports`. Because `netlink` is not used in any file visible under `GOOS=darwin`, goimports rewrites the imports to remove it… but only on this file, which still references `netlink`. The next pull request:

```go
import "fmt"   // netlink removed!
```

```bash
$ GOOS=linux go build
./net_linux.go:9:21: undefined: netlink
```

**Bug:** `goimports` evaluates imports against the *current* build tags. When run on macOS, it does not see `net_linux.go` as part of the build and over-eagerly drops the import — even though it appears literally in the file.

**Fix:** do not rely on `goimports` to manage imports inside files with build tags; pin imports manually, or ensure your editor invokes `goimports` with the right `GOOS`. Most teams configure CI to run `goimports -l .` against every supported platform and fail if the diff is non-empty:

```bash
$ GOOS=linux  goimports -l .
$ GOOS=darwin goimports -l .
```

The IDE-level fix: tell your editor to set `GOFLAGS=-tags=linux` (or both) when running formatters on these files.

---

## Bug 21 — Blank import grouped wrong, formatter rearranges it

```go
import (
    _ "github.com/lib/pq"
    "fmt"
    "net/http"
    "os"
)
```

After `gofmt`/`goimports`:

```go
import (
    "fmt"
    "net/http"
    "os"

    _ "github.com/lib/pq"
)
```

Or worse, in some setups:

```go
import (
    "fmt"
    _ "github.com/lib/pq"   // sorted between f and n
    "net/http"
    "os"
)
```

```bash
$ go vet
# (no error, but reviewer flags it)
```

**Bug:** Blank imports (`_ "path"`) and forced imports look like normal imports to `gofmt`. They get sorted alphabetically and grouped with everything else. The intent — "this import has side effects, treat it specially" — is lost; readers see it mixed in with regular packages and may delete it during cleanup.

**Fix:** put blank imports in their own group, separated by a blank line. `gofmt` respects existing groups; once they exist, it will not merge them:

```go
import (
    "fmt"
    "net/http"
    "os"

    _ "github.com/lib/pq" // postgres driver
)
```

Add a comment explaining *why* the blank import exists. Future-you (and CI) will not delete it.

---

## Bug 22 — `replace` to a folder whose `go.mod` has a different module name

```go.mod
// file: go.mod
module github.com/me/app

go 1.22

require github.com/me/shared v1.0.0

replace github.com/me/shared => ../shared
```

```go.mod
// file: ../shared/go.mod
module github.com/me/shared-internal   // !!

go 1.22
```

```bash
$ go build ./...
go: github.com/me/app: github.com/me/shared@v0.0.0-00010101000000-000000000000
(replaced by ../shared): replacement module has different module path
"github.com/me/shared-internal" but "github.com/me/shared" is required
```

**Bug:** When you `replace` a module path with a local directory, the *target's* `go.mod` must declare the same module path you are replacing. Here `replace github.com/me/shared => ../shared` points at a directory whose `go.mod` says `github.com/me/shared-internal` — so Go refuses.

**Fix:** either rename the target's `go.mod`:

```go.mod
// file: ../shared/go.mod
module github.com/me/shared
```

Or change the `replace` to use the actual module name:

```go.mod
require github.com/me/shared-internal v0.0.0

replace github.com/me/shared-internal => ../shared
```

Use `go.work` for multi-module local development; it sidesteps `replace` entirely and tracks paths cleanly:

```bash
$ go work init . ../shared
```

---

## Summary

Most package-import bugs come from one of these mistakes:

1. **Treating package boundaries casually.** Cycles (Bug 1, 19), `internal/` (Bug 7), and exported/unexported identifiers (Bug 2, 13) are not advisory — the compiler enforces them.
2. **Diverging the package name from the folder name.** Folder, `package` clause, and import alias should agree. Bugs 8, 17 stem from misalignment.
3. **Trusting tooling on a single platform.** `goimports` (Bug 20), `go mod tidy` (Bug 18), and editor format-on-save can silently break cross-platform builds. CI must run on every supported `GOOS`.
4. **Letting side-effects slip.** Blank imports (Bug 5, 15, 21), `init()` order (Bug 14), and missing comments make code that "just works" until somebody innocently rearranges it.
5. **Mixing local and published state.** `replace` with mismatched names (Bug 22), `vendor` vs `-mod=mod` (Bug 16), and casing on case-insensitive filesystems (Bug 9) appear only when somebody else clones the repo.

Fix the rules at the toolchain layer — `go vet`, `gofmt`, `golangci-lint`, multi-platform CI — and most of this list never reaches a code review again.
