# Package Import Rules — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [Core Concepts](#core-concepts)
5. [Real-World Analogies](#real-world-analogies)
6. [Mental Models](#mental-models)
7. [Pros & Cons](#pros-cons)
8. [Use Cases](#use-cases)
9. [Code Examples](#code-examples)
10. [Coding Patterns](#coding-patterns)
11. [Clean Code](#clean-code)
12. [Product Use / Feature](#product-use-feature)
13. [Error Handling](#error-handling)
14. [Security Considerations](#security-considerations)
15. [Performance Tips](#performance-tips)
16. [Best Practices](#best-practices)
17. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
18. [Common Mistakes](#common-mistakes)
19. [Common Misconceptions](#common-misconceptions)
20. [Tricky Points](#tricky-points)
21. [Test](#test)
22. [Tricky Questions](#tricky-questions)
23. [Cheat Sheet](#cheat-sheet)
24. [Self-Assessment Checklist](#self-assessment-checklist)
25. [Summary](#summary)
26. [What You Can Build](#what-you-can-build)
27. [Further Reading](#further-reading)
28. [Related Topics](#related-topics)
29. [Diagrams & Visual Aids](#diagrams-visual-aids)

---

## Introduction
> Focus: "What does the `import` keyword actually do?" and "What rules govern those quoted strings?"

You have run `go mod init` and watched `go mod tidy` pull in some third-party libraries. Your editor auto-completes `fmt.Println`. Things mostly work. But sooner or later — usually the moment you split your code into a sub-folder — you hit a wall:

```
package main
        imports github.com/alice/cool/cmd: 
        package github.com/alice/cool/cmd is not in std
```

or:

```
import cycle not allowed
```

or:

```
use of internal package github.com/alice/cool/internal/db not allowed
```

Each of these is the import system telling you a rule has been broken. This file is the rulebook. After reading it you will:

- Read any `import "..."` line and explain exactly what Go does with it.
- Tell the difference between an **import path** (where to find a package) and a **package name** (what you write to use it).
- Use aliases, blank imports, and dot imports — and know when each is appropriate.
- Understand why `internal/` is special, and predict who can and cannot import an `internal/` package.
- Diagnose import cycles and know how to break them.
- Recognise the formatting that `goimports` produces and why it groups imports the way it does.

You do **not** need to know about Go modules versions, vendoring, or how the proxy fetches code. Those came earlier. This file is about what happens *after* the bytes of a package are on your disk and the compiler walks the `import` block of your `.go` file.

---

## Prerequisites

- **Required:** A working Go installation (1.16 or newer) and a project that already has a `go.mod`. Check with `go version` and `cat go.mod`.
- **Required:** You have used `import "fmt"` before and called `fmt.Println`.
- **Required:** You understand that Go source files belong to a *package*, declared by `package <name>` at the top of every `.go` file.
- **Helpful:** You have created at least one sub-folder of `.go` files in a project and tried to call across them.
- **Helpful:** You have edited an `import` block by hand, even if just to add `"strings"`.
- **Helpful:** Familiarity with `goimports` or your editor's "organise imports" command.

If `go vet ./...` runs cleanly on a current project, you have all the muscle memory needed.

---

## Glossary

| Term | Definition |
|------|-----------|
| **Import path** | The string inside the quotes after `import`. A globally unique address that tells the Go toolchain where to find a package. |
| **Package name** | The identifier written inside the package after `package <name>`. What you actually type in code (`fmt.Println`). |
| **Standard library** | The packages shipped with the Go toolchain (`fmt`, `os`, `net/http`, ...). Their import paths have no domain segment. |
| **Third-party package** | Any package that lives outside the standard library; usually identified by a URL-shaped import path. |
| **Alias** | A local name given to an imported package: `import foo "long/path/to/pkg"` lets you write `foo.X` instead of `pkg.X`. |
| **Blank import** | `import _ "..."` — pulls a package in *only* for its side effects. The package name is not bound to a usable identifier. |
| **Dot import** | `import . "..."` — splices the imported package's exported names into the current file, so you can write `Println` instead of `fmt.Println`. |
| **`init()` function** | A special function with no parameters and no return that Go runs once per package, before `main`. |
| **Cyclic import** | A configuration where package A imports package B and B (directly or transitively) imports A. Forbidden. |
| **`internal/` directory** | A path-segment with special access rules: only code rooted at the parent of `internal/` can import packages under it. |
| **`goimports`** | A tool that formats and groups import blocks; the de facto standard formatter beyond `gofmt`. |
| **Import group** | A run of `import` lines separated from other groups by a blank line. `goimports` produces two: stdlib, then third-party. |

---

## Core Concepts

### Imports are by *path*, not by *name*

When you write:

```go
import "fmt"
```

Go does **not** search for "a package called fmt." It looks up the *import path* `fmt` in its known locations (the standard library, the module cache). Once it finds the source files, it reads the `package <name>` declaration inside them — and *that* is the name you use in your code.

For the standard library, path and name happen to match (`fmt` is the path, `fmt` is the name). For third-party code, they almost always match by convention. But they do not have to match, and a few important packages exploit this. Always remember:

- The **path** (`"github.com/x/y/y"`) tells Go *where to find the bytes*.
- The **name** (`y` or whatever the source declares) tells you *what to write in code*.

### The package name is whatever the source files say it is

Every `.go` file in a package starts with `package <name>`. That name is the only name you can use to refer to the package's exports — unless you alias it. The convention (almost universally followed) is that the name matches the last segment of the import path. So `net/http` → `http`. So `github.com/alice/cool/greet` → `greet`.

The notable exceptions you will meet early:

- `gopkg.in/yaml.v3` → package name `yaml` (the version suffix `v3` is path-only).
- `golang.org/x/sync/errgroup` → package name `errgroup`.
- `github.com/jackc/pgx/v5/pgxpool` → package name `pgxpool` (the `v5` is path-only).

When in doubt, open the source. The first non-comment line of any `.go` file in the package tells you the name.

### `import` is per file, not per package

Every `.go` file has its own `import` block. If two files in the same package both need `fmt`, both files import `fmt`. There is no shared "imports for this package." Imports are file-local.

### You can alias an import

```go
import foo "github.com/alice/another-foo"

foo.Bar()
```

Reasons to alias:

- **Two packages collide.** You import `crypto/rand` and `math/rand`; one of them must be aliased.
- **The package's natural name is awkward.** Some legacy packages have ugly names; an alias makes call sites readable.
- **Disambiguation in tests.** `import myfoo "..."` clarifies which `foo` you mean when test fixtures are involved.

Aliasing is **local to the file**. It does not rename the package globally; another file in the same package can give it a different alias or use no alias at all.

### Blank imports run `init()` for side effects

```go
import _ "github.com/lib/pq"
```

You are not going to call any function named `pq.Something`. You are saying: "I want this package's `init()` to run." The classic example is database drivers: importing `github.com/lib/pq` registers the `postgres` driver with `database/sql`, after which you can call `sql.Open("postgres", ...)`.

Blank imports are the *only* way to use a package solely for side effects without the compiler complaining about an unused import.

### Dot imports merge the namespace

```go
import . "fmt"

Println("hello")
```

This works. It is also **strongly discouraged** outside test files because it makes call sites unreadable — readers cannot tell at a glance which package an identifier came from. The two acceptable contexts are:

- **Inside `_test.go` files** that test the package itself, where dot-importing helper packages is sometimes idiomatic.
- **DSL-style libraries** that explicitly invite this style (rare; the Ginkgo testing framework is the famous example).

In all other contexts: do not use dot imports.

### `internal/` enforces visibility by path

A directory named `internal/` anywhere in your module creates a visibility boundary. Code under `internal/` can only be imported by code rooted at the *parent* of that `internal/` directory. The Go compiler enforces this — it is not a convention, it is a rule.

```
github.com/alice/cool/
├── go.mod
├── main.go                       <-- can import internal/db
├── cmd/
│   └── server/main.go            <-- can import internal/db
├── internal/
│   └── db/db.go                  <-- restricted package
└── pkg/
    └── public/public.go          <-- can import internal/db
```

But `github.com/bob/anothertool` *cannot* import `github.com/alice/cool/internal/db`. The toolchain refuses.

### Cyclic imports are forbidden

If A imports B, B cannot import A — directly or transitively. Go compiles each package once, and a cycle would mean neither can be compiled first. The compiler stops you with a clear error. The fix is always either (a) break the dependency by extracting a common type into a third package, or (b) merge the two packages.

### `init()` runs once per package, depth-first

When you import a package, all packages it imports are initialised first, recursively. Each package's variable initialisers run, then each `init()` function runs (in source-file alphabetical order, then declaration order within a file). Then your package initialises. By the time `main` runs, every reachable package's `init()` has fired exactly once.

### `goimports` groups imports

`gofmt` only reorders within groups and won't *create* groups. `goimports` does both. The convention it implements:

```go
import (
    "fmt"           // group 1: standard library
    "net/http"
    "os"

    "github.com/alice/cool/greet"  // group 2: everything else
    "github.com/lib/pq"
)
```

Some projects use three groups (stdlib / module-internal / external), but the two-group convention is dominant. Configure your editor to run `goimports` on save and you stop thinking about it.

---

## Real-World Analogies

**1. A telephone directory.** The import path is the phone number — globally unique, dialled to reach a specific party. The package name is the person who picks up the phone — that is who you talk to. Usually the number is listed under the same name, but a person might answer "Hello, this is the Acme Bakery."

**2. A library card catalogue.** The import path is the call number on the spine; that is how the librarian (the toolchain) finds the book. The package name is the title printed on the cover; that is what you tell your friends about. They are linked but not the same thing.

**3. A house's address vs. the family inside.** "1600 Pennsylvania Avenue" is the import path. "The Smith family" is the package name. You drive to the address; you greet the family by name.

**4. Building access by badge.** The `internal/` directory is like a security door inside a corporate building. Anyone in the company (descendants of the door's parent floor) can enter. Visitors from other companies (other modules) cannot — the badge reader rejects them. The rule is enforced by the building, not by politeness.

**5. A study group with circular references.** You cannot finish chapter 1 until you finish chapter 2, and you cannot finish chapter 2 until you finish chapter 1. No reading order works. That is an import cycle — Go refuses to start.

---

## Mental Models

### Model 1 — "Import path is the address; package name is the doorbell"

The path tells the toolchain where to walk. The name is what you ring once you arrive. A junior gotcha: trying to write `yaml.v3.Marshal` because the path ends in `v3`. There is no `v3` symbol — the package name is just `yaml`.

### Model 2 — "Each file has its own import list"

Imports are not module-wide or even package-wide. They are file-wide. If two files in the same package both need `os`, they both import `os`. The compiler resolves them per file. This means one file in a package can alias `foo` while another file uses the un-aliased name — both work.

### Model 3 — "A blank import is a registration call"

Think of `import _ "x"` as saying "run x's setup hooks." You will never reference `x` by name; you only need its setup to run. It is the moral equivalent of calling a void function once at startup.

### Model 4 — "internal/ is a namespace fence, not a comment"

`internal/` is not a naming convention you can override with discipline. It is a compile-time gate. Code that would import across the fence simply does not build. Use this fact deliberately: anything you do not want to be a public API of your module belongs under `internal/`.

### Model 5 — "Cycles mean your packages are wearing each other's clothes"

If A and B both import each other, they are not really two packages — they are one package wearing two costumes. The fix is to figure out what they share and put it somewhere both can import without going back through the other.

### Model 6 — "Init order is depth-first reverse"

Your `main` is the last `init()` to run. Whatever you import, *that* package's imports init first, then it, then your code. Like a stack.

---

## Pros & Cons

### Pros

- **Explicit dependencies.** Every external symbol your file uses is named at the top of the file. Reviewers see the surface area immediately.
- **Cycle prevention by design.** The compile-time cycle check forces sane architecture.
- **`internal/` for free.** A pure-path mechanism for module privacy, no `private` keyword needed.
- **One canonical formatter.** `goimports` removes import-block bikeshedding from code review.
- **Aliases are escape valves.** Path-name conflicts are solved without breaking the convention.

### Cons

- **No relative imports.** You cannot write `import "./greet"`. Every import is by full path. New users find this verbose.
- **Path matches repo URL.** Renaming a repo means breaking every importer. This is unavoidable but painful.
- **Cycles can be hard to refactor.** Breaking a cycle in mature code can require extracting types to a new package, which ripples through many files.
- **Dot imports tempt newcomers.** They look concise; they cost readers their bearings. Most projects ban them outright.
- **`internal/` is invisible.** A package in `internal/` is unfindable on `pkg.go.dev`; well-meaning users will copy-paste rather than realise they should not depend on it.

The pros dominate. Most cons are mitigated with discipline and tooling.

---

## Use Cases

You will use the import-related rules when:

- **Calling the standard library.** Almost every Go file imports something from the stdlib.
- **Splitting your code into sub-packages.** As soon as your module has more than one folder, imports between them follow these rules.
- **Adding a third-party dependency.** `go get github.com/x/y` then `import "github.com/x/y"`.
- **Registering a database driver, image format, or HTTP handler.** Blank imports.
- **Hiding implementation details.** Move them under `internal/`.
- **Resolving a name collision.** Aliasing.
- **Refactoring a growing package into smaller ones.** Cycle detection becomes your guide.

Conversely, you will *not* use these rules to:

- Make a directory's code visible — that is automatic from `package <name>` plus folder layout.
- Run setup code on demand — that is just calling a function, not an import.
- Install a dependency — that is `go get` / `go mod tidy`, not `import`.

---

## Code Examples

### Example 1 — Importing the standard library

```go
package main

import "fmt"

func main() {
    fmt.Println("hello, world")
}
```

`"fmt"` is the import path. `fmt` is the package name. They match by convention.

### Example 2 — Importing your own sub-package

Module: `github.com/alice/cool` with this layout:

```
cool/
├── go.mod                  (module github.com/alice/cool)
├── main.go
└── greet/
    └── greet.go
```

`greet/greet.go`:

```go
package greet

import "fmt"

func Hello(name string) {
    fmt.Println("hello,", name)
}
```

`main.go`:

```go
package main

import "github.com/alice/cool/greet"

func main() {
    greet.Hello("Alice")
}
```

The import path is `<module path>/<sub-folder>`. The package name `greet` is what `greet.go` declares.

### Example 3 — Importing a third-party package

After `go get github.com/google/uuid`:

```go
package main

import (
    "fmt"

    "github.com/google/uuid"
)

func main() {
    fmt.Println(uuid.New())
}
```

Two import groups separated by a blank line: stdlib first, then third-party. `goimports` produces this layout automatically.

### Example 4 — Aliasing to resolve a collision

```go
package main

import (
    "fmt"
    crand "crypto/rand"
    mrand "math/rand"
)

func main() {
    _ = crand.Reader
    fmt.Println(mrand.Intn(100))
}
```

Without the aliases, both packages declare `rand` and the compiler refuses. Aliasing renames them locally.

### Example 5 — Aliasing a long or awkward path

```go
import (
    pq "github.com/jackc/pgx/v5/pgxpool"
)

func use(p *pq.Pool) { /* ... */ }
```

Here the package name is already `pgxpool`, but the developer wanted a shorter alias. Use sparingly — the original name is usually clearer.

### Example 6 — Blank import for a SQL driver

```go
package main

import (
    "database/sql"

    _ "github.com/lib/pq"
)

func main() {
    db, err := sql.Open("postgres", "postgres://localhost/mydb")
    _ = db
    _ = err
}
```

The blank import is **required**. Without it, `pq.init()` never runs, the `"postgres"` driver is never registered, and `sql.Open("postgres", ...)` returns "unknown driver" at runtime.

### Example 7 — Dot import (in a test, where it is acceptable)

`mypkg/example_test.go`:

```go
package mypkg_test

import (
    . "github.com/alice/cool/mypkg"
    "testing"
)

func TestStuff(t *testing.T) {
    if Greet("a") != "hello, a" {
        t.Fail()
    }
}
```

The dot import lets the test file write `Greet` instead of `mypkg.Greet`. This is one of the few places it is idiomatic.

### Example 8 — A failed cyclic import

`a/a.go`:

```go
package a

import "github.com/alice/cool/b"

func A() { b.B() }
```

`b/b.go`:

```go
package b

import "github.com/alice/cool/a"

func B() { a.A() }
```

`go build`:

```
import cycle not allowed
package github.com/alice/cool/a
        imports github.com/alice/cool/b
        imports github.com/alice/cool/a
```

Fix: extract the shared type or interface into a third package, e.g. `c`, that both `a` and `b` import.

### Example 9 — A failed `internal/` import

`github.com/alice/cool/internal/db/db.go`:

```go
package db

func Query() string { return "data" }
```

In a *different* module, `github.com/bob/tool/main.go`:

```go
package main

import "github.com/alice/cool/internal/db"

func main() { _ = db.Query() }
```

`go build`:

```
use of internal package github.com/alice/cool/internal/db not allowed
```

The compiler rejects it because Bob's module is not rooted at `github.com/alice/cool`. Inside Alice's module, the same import works fine.

---

## Coding Patterns

### Pattern: Group imports stdlib-then-third-party

```go
import (
    "context"
    "fmt"
    "net/http"

    "github.com/google/uuid"
    "go.uber.org/zap"
)
```

Single blank line between groups. Run `goimports` on save and stop thinking about it.

### Pattern: Alias only when forced

Aliases are noise. Only alias when you must:

- Two packages share a name.
- The name conflicts with a local identifier.
- A test renames its subject for clarity.

If you find yourself aliasing for aesthetics, stop. The reader has to look up the alias.

### Pattern: Blank-import drivers in `main`, not in libraries

```go
// cmd/server/main.go  -- OK to blank-import here
package main

import (
    _ "github.com/lib/pq"
)
```

```go
// internal/db/db.go   -- AVOID blank imports here
```

A library that blank-imports a driver forces every consumer to take that dependency, even if they want a different driver. Keep driver registration at the application's entry point.

### Pattern: One sub-package per cohesive concern

If two sub-packages keep wanting to import each other, they probably want to be one package. Or they want a third package to share what they have in common. Either is fine; the cycle is the symptom that the design is not.

### Pattern: Hide internals under `internal/`

When a package is "implementation only, do not import from outside," put it under `internal/`. The compiler will police the boundary for you.

```
mymodule/
├── go.mod
├── api/             <-- public; importable by anyone
└── internal/
    └── secret/      <-- private; only mymodule can import
```

---

## Clean Code

- **No dot imports outside tests.** Ever.
- **Imports follow the canonical order.** stdlib, blank line, everything else. Let `goimports` enforce it.
- **No unused imports.** The compiler enforces this; do not silence it with blank imports just to "keep things in scope."
- **No commented-out imports.** Delete them. Git remembers.
- **Aliases are short, lowercase, and meaningful.** `pq` for `lib/pq`, not `Postgres_DB_Driver`.
- **Order long import lists alphabetically within each group.** `goimports` does this.
- **Prefer the shortest unambiguous import path.** Don't mix `gopkg.in/yaml.v3` and `gopkg.in/yaml.v2` in the same file unless you really mean to.

A clean import block is short, sorted, grouped, and silent — readers should not have to think about it.

---

## Product Use / Feature

When shipping production Go code, the import system shows up in:

- **Build reproducibility.** Imports in source + versions in `go.sum` is the entire dependency-graph of your binary.
- **Supply-chain audits.** `go list -m all` walks every imported module — your import statements drive that list.
- **Static analysis.** Tools like `go vet`, `staticcheck`, and `gosec` operate on imports to flag dangerous packages.
- **Build size.** Every imported package compiles into your binary. Slim imports → slim binaries.
- **Compliance.** Some companies allow only a curated list of import paths; CI checks for forbidden imports.

Treat imports as a public surface — they are visible to every reader and tool that touches your code.

---

## Error Handling

The compiler handles most import-related errors at build time. The messages you will see, and how to fix them:

### `imported and not used: "fmt"`

You added an import but never called any function from it. Fix: delete the import, or actually use it. If you genuinely need only the side effects, change to `_ "fmt"` (rare for stdlib).

### `undefined: somepkg`

You used `somepkg.Thing` but did not import the package. Fix: add the import, or correct the name.

### `import cycle not allowed`

A and B import each other. Fix: extract shared types into a third package, or merge.

### `use of internal package ... not allowed`

You tried to import an `internal/` package from outside its allowed subtree. Fix: move your code under the subtree, or ask the upstream maintainer to expose a public version of what you need.

### `package <name> is not in std (...)`

You wrote a typo or an unfound path. Fix: spell-check; run `go mod tidy`; verify the module is in `go.mod`.

### `cannot find package "..." in any of: ...`

The toolchain looked in known places and did not find the path. Fix: run `go mod tidy`, or add the dependency with `go get`.

### `redeclared in this block` after aliasing

Your alias collides with a local identifier. Fix: pick a different alias.

### Errors at runtime: `unknown driver "postgres"`

You forgot the blank import for `lib/pq`. Add `_ "github.com/lib/pq"` to your `main` package.

---

## Security Considerations

- **Blank imports run code at startup.** A blank-imported package's `init()` can do *anything*: open files, dial network, mutate global state. Audit what you blank-import. Never blank-import a package you have not vetted.
- **`internal/` is your enforcement boundary.** Put security-sensitive code (token signing, password hashing, raw secrets) under `internal/` so accidental external imports are impossible.
- **Typosquatting via paths.** `github.com/golamg/...` looks like `golang/...`. Always copy-paste import paths from the upstream README; never type third-party paths from memory.
- **Dot imports hide call sites.** A malicious dependency could shadow a stdlib name. Avoiding dot imports avoids this attack surface.
- **Aliases obscure dependencies.** A reviewer skimming for "what does this code call?" might miss a dependency hidden behind a creative alias. Prefer no alias when not needed.
- **Diamond dependencies amplify supply chain risk.** Your import + transitive imports = your real attack surface. Audit `go list -m all`, not just your direct imports.

---

## Performance Tips

- Imports themselves cost nothing at runtime — they are resolved at compile time. There is no `import` instruction in the binary.
- A package's `init()` runs once at program start. Heavy initialisation in an imported package's `init()` slows your startup. Profile cold starts if startup time matters (CLIs, serverless).
- Blank imports still run `init()`. If a package does network work in `init()`, blank-importing it makes your binary do that work too.
- More imports → larger binary. The Go linker is smart but cannot eliminate functions you have, in principle, made reachable. If binary size matters, audit imports.
- Cyclic-dependency hunting tools (`gomod-graph`, `goda`) can be slow on large modules; run them in CI, not on every save.

For most code, none of this matters — imports are essentially free.

---

## Best Practices

1. **Run `goimports` on save.** It groups, sorts, removes unused, and adds missing imports. Eliminates import-related code review nits.
2. **Match package name to last path segment.** Make life easy for readers.
3. **Alias only on collision or for clarity.** Aliases are noise; minimise.
4. **Never use dot imports outside tests.** Even in tests, prefer not to.
5. **Blank-import drivers in `main`, not in libraries.** Pushes the dependency choice to the application.
6. **Put unstable APIs under `internal/`.** Nothing prevents future breakage like preventing future imports.
7. **Resolve cycles by extracting common types.** Do not try to plaster over them with interfaces in the wrong package.
8. **Keep imports alphabetised within each group.** `goimports` does this; trust it.
9. **One blank line between import groups.** Two blank lines is wrong; zero is wrong.
10. **Read the package source when in doubt about the package name.** First non-comment line tells you.

---

## Edge Cases & Pitfalls

### Pitfall 1 — Path looks right, name is different

```go
import "gopkg.in/yaml.v3"

yaml.v3.Marshal(...)   // ERROR: undefined yaml.v3
yaml.Marshal(...)      // CORRECT
```

The `v3` is part of the path, not part of the name. Always check the actual `package` declaration in the source.

### Pitfall 2 — `internal/` near the module root vs. deep

A package at `mymodule/internal/foo` is importable by every package in `mymodule`. A package at `mymodule/sub/internal/foo` is only importable by packages under `mymodule/sub/`. Where you put `internal/` controls who can see it.

### Pitfall 3 — Cycle through transitive imports

A cycle is forbidden even if it is not direct. A → B → C → A is a cycle just as much as A → A. Tools like `goda graph` help visualise this.

### Pitfall 4 — `init()` runs even for blank imports

Blank imports are not "passive." They run code. If a blank-imported package has a slow or failing `init()`, your program is affected.

### Pitfall 5 — Two packages in the same folder

You cannot have two `package` declarations in the same directory (with one exception: an `_test.go` file can declare `package foo_test`). Mismatched package names in one folder produce: `found packages foo (a.go) and bar (b.go)`.

### Pitfall 6 — Capital-letter modules and case sensitivity

`github.com/Alice/Repo` and `github.com/alice/repo` are different paths to the Go proxy, even though Git often treats them the same. Stick to lowercase.

### Pitfall 7 — Blank-importing a package twice

Harmless — `init()` only runs once per package per build. But it suggests you have not consolidated your imports.

### Pitfall 8 — Editor adds an unwanted alias

Some editors auto-alias when they think there is a collision. Check the import block before committing — a stray alias can confuse reviewers.

### Pitfall 9 — Test-only imports leak into production

If you import a testing helper from a non-`_test.go` file, you have just made your test framework a runtime dependency of your binary. Keep test-only imports inside `_test.go` files.

### Pitfall 10 — Aliasing the package to its own name

```go
import http "net/http"   // legal but pointless
```

The alias is the same as the default name. Some linters flag this. Just use `import "net/http"`.

---

## Common Mistakes

- **Importing by guessing.** Don't write `import "uuid"` and hope. Look up the real path.
- **Confusing package name with path.** Trying to call `gopkg.in.yaml.v3.Marshal` instead of `yaml.Marshal`.
- **Using `_` to silence "imported and not used" temporarily.** It "works" but loses you the compiler's safety. Either use the package or remove the import.
- **Trying to import a sub-folder by relative path.** `import "./sub"` does not work. Use the full path: `import "github.com/me/mod/sub"`.
- **Putting all packages under `internal/` "to be safe."** That kills reusability. `internal/` is for things that genuinely should not be public.
- **Adding an alias because the call site reads better.** It rarely does. Aliases are needed, not preferred.
- **Forgetting the blank line between import groups.** `goimports` would fix it; review tools complain about it.
- **Forgetting the blank import for SQL drivers.** Then debugging `sql: unknown driver "postgres"` for an hour.
- **Trying to break a cycle by adding interfaces in one of the cycling packages.** Move the interface to a third package; placing it in either of the original two does not fix the cycle.

---

## Common Misconceptions

> *"The package name is the last segment of the import path."*

By convention, yes. By rule, no. The package name is whatever the source files say. Convention covers 95% of cases; check the source for the rest.

> *"Imports work by relative path."*

They never do. There is no `import "./foo"`, no `import "../bar"`. Every import is a full, canonical path.

> *"`internal/` is just a naming convention."*

It is a *compiler-enforced rule*. The build literally fails if you violate it.

> *"Blank imports do nothing."*

They run `init()`. They can register drivers, allocate state, dial networks. They are anything but inert.

> *"Dot imports save typing and are therefore good."*

They save typing and destroy readability. Outside tests, they are universally discouraged.

> *"An import cycle can be fixed by aliasing."*

No. Aliasing renames; it does not break the dependency. The fix is structural — extract or merge.

> *"Tests are part of the package and so use the package's imports."*

A test file in `package foo` shares the package and its imports. A test file in `package foo_test` is a *separate* package and has its own imports — including, often, a non-blank import of `foo` itself.

> *"`goimports` and `gofmt` are interchangeable."*

`goimports` is `gofmt` plus import-list management. Use `goimports`.

---

## Tricky Points

- **Aliasing scope is per file.** `import foo "x"` in `a.go` does not let `b.go` (same package) write `foo.Bar` — `b.go` would still write `x.Bar` (or its own alias).
- **`init()` order across packages is determined by the import graph.** Within a package, `init()` order is determined by source-file alphabetical order, then declaration order in each file. Do not rely on this for correctness; use explicit ordering.
- **You can have multiple `init()` functions per file.** They run top-to-bottom. Most code has zero or one.
- **A blank import of a package that has *no* `init()` and no package-level vars with side effects does literally nothing.** The compiler still verifies the package compiles, but nothing runs.
- **Test imports are evaluated lazily.** A test-only dependency is not in your release binary. Run `go list -test -deps .` to see test-only imports.
- **`internal/` only applies inside modules.** A folder named `internal/` outside a Go module is just a folder — there is no rule to enforce.
- **Two packages with the same name from different paths can both be imported in one file** — *if* you alias one of them. They are different packages; only their default names collide.
- **`goimports` chooses imports for unresolved identifiers.** If you write `uuid.New()` without an import, `goimports` may add `github.com/google/uuid` *or* `github.com/satori/go.uuid` — based on what is in your module cache and `go.mod`. Always check what was added.

---

## Test

Try this in a scratch module.

```bash
mkdir cooltest
cd cooltest
go mod init example.com/cooltest
mkdir -p greet internal/secret
```

Create `greet/greet.go`:

```go
package greet

import "fmt"

func Hello() { fmt.Println("hi") }
```

Create `internal/secret/secret.go`:

```go
package secret

const Token = "shh"
```

Create `main.go`:

```go
package main

import (
    "example.com/cooltest/greet"
    "example.com/cooltest/internal/secret"
)

func main() {
    greet.Hello()
    println(secret.Token)
}
```

Run `go run .`. It works.

Now answer:
1. What happens if you copy `main.go` into a *different* module and try to build it? (Answer: `internal/secret` import fails.)
2. What happens if you make `greet/greet.go` import `example.com/cooltest`? (Answer: cycle, build fails.)
3. What happens if you change `main.go` to `import _ "example.com/cooltest/greet"` and remove the `greet.Hello()` call? (Answer: builds; `greet` has no `init()`, so nothing happens at runtime.)
4. What is the package name of `gopkg.in/yaml.v3`? (Answer: `yaml`.)

---

## Tricky Questions

**Q1.** Why is `import "fmt"` enough to write `fmt.Println` but `import "gopkg.in/yaml.v3"` lets you write `yaml.Marshal`, not `yaml.v3.Marshal`?

A. Because the *package name* is declared inside the source files of the package — for `gopkg.in/yaml.v3`, the source declares `package yaml`. The import path is just an address; the name is whatever the package's source says. For `fmt`, path and name happen to match.

**Q2.** Is `import . "fmt"` legal?

A. Yes, and it works (`Println("hi")` would compile). It is legal but discouraged outside test files because it removes the package qualifier from call sites.

**Q3.** I added `_ "github.com/lib/pq"` and now my binary takes 200ms longer to start. Why?

A. Blank imports run the package's `init()`. `lib/pq` registers itself with `database/sql` in `init()`. If startup time matters, profile and consider lazy initialisation.

**Q4.** `A` and `B` import each other. The compiler errors. I added `_ "B"` in `A` instead of an import — does that fix the cycle?

A. No. A blank import is still an import. Cycle detection counts it. The fix is structural.

**Q5.** Why can't I write `import "../greet"` in `cmd/main.go`?

A. Go does not support relative imports. Every import is a full canonical path. Use `import "github.com/me/mymod/greet"` or whatever the absolute path is.

**Q6.** I have two third-party packages both called `client`. How do I import both?

A. Alias at least one: `import alpha "github.com/foo/client"` and `import beta "github.com/bar/client"`. Then write `alpha.New(...)` and `beta.New(...)`.

**Q7.** `internal/` package: who exactly can import it?

A. Any package whose import path begins with the parent of the `internal/` directory. So `mymod/internal/foo` is importable by `mymod`, `mymod/anything`, `mymod/anything/else`. It is **not** importable by other modules — even if they try to import `mymod`.

**Q8.** Is `import . "fmt"` ever a good idea in production code?

A. Effectively no. The two narrow cases people defend are (1) test files testing the package, and (2) DSL-style libraries that explicitly invite it. In ordinary production code it harms readability with no real upside.

**Q9.** I can see my dependency in `go.mod`, but `import "github.com/x/y"` says "package not found." What is wrong?

A. The module is in `go.mod`, but the *path* you wrote does not match a package inside the module. Maybe the package is at `github.com/x/y/sub`, not at the module root. Check the module's source layout.

**Q10.** Why does `goimports` group stdlib first?

A. It is a community convention; readers know to find the "comfortable" stdlib imports at the top and the "be skeptical of these" third-party imports below the blank line. Some projects use three groups (stdlib / module-local / external) for the same reason.

**Q11.** If I delete the only line that uses `fmt` from a file, what does `goimports` do?

A. It removes the `import "fmt"` automatically on save. The compiler would have rejected the build with "imported and not used"; `goimports` saves you that round-trip.

**Q12.** Can `init()` return an error?

A. No. `init()` has no parameters and no return. If `init()` cannot succeed, it must `panic` — which crashes the program. This is by design: a package that cannot initialise should not be loaded.

---

## Cheat Sheet

```go
// Single import
import "fmt"

// Grouped imports (preferred)
import (
    "fmt"
    "net/http"

    "github.com/google/uuid"
)

// Alias
import foo "github.com/x/y"

// Blank import (side effects only)
import _ "github.com/lib/pq"

// Dot import (DISCOURAGED outside tests)
import . "fmt"
```

| Need | Form |
|------|------|
| Use a stdlib package | `import "fmt"` |
| Use a sub-package of your module | `import "github.com/me/mod/sub"` |
| Use a third-party package | `import "github.com/x/y"` |
| Avoid name collision | `import alt "github.com/x/y"` |
| Run init() side effects only | `import _ "github.com/x/y"` |
| Splice exported names locally | `import . "github.com/x/y"` (avoid) |

| Symptom | Likely Cause |
|---------|-------------|
| `imported and not used` | Delete or use the import |
| `import cycle not allowed` | Extract shared types into a third package |
| `use of internal package not allowed` | You are outside the allowed subtree |
| `cannot find package` | Run `go mod tidy`; verify path spelling |
| `unknown driver "postgres"` | Missing `_ "github.com/lib/pq"` blank import |
| `redeclared in this block` (alias) | Alias collides with a local name |

```
goimports group order:
    1. stdlib       (no domain in path)
    [blank line]
    2. everything else
```

```
internal/ rule:
    Any code rooted at the parent of internal/ may import packages under it.
    Anywhere else, the import is forbidden by the compiler.
```

---

## Self-Assessment Checklist

You can move on to [middle.md](middle.md) when you can:

- [ ] Explain the difference between an import path and a package name
- [ ] Write an import block grouped stdlib-then-third-party with one blank line
- [ ] Use an alias to resolve a name collision between two packages
- [ ] Use a blank import to register a SQL driver and explain why it is necessary
- [ ] Recite at least two reasons not to use dot imports
- [ ] State the `internal/` rule precisely (the parent-of-`internal/` rule)
- [ ] Detect and break a simple cyclic-import situation
- [ ] Explain when a package's `init()` runs and how often
- [ ] Predict the package name of `gopkg.in/yaml.v3`, `golang.org/x/sync/errgroup`, and `github.com/jackc/pgx/v5/pgxpool` from their paths
- [ ] Configure your editor to run `goimports` on save
- [ ] Recognise the four most common compiler errors related to imports

---

## Summary

Imports in Go are governed by a small set of strict rules: every import is by full canonical path; the package's name is whatever its source files declare (almost always the last segment of the path); aliases provide local renaming when collisions force the issue; blank imports run `init()` for side effects; dot imports merge namespaces and are nearly always wrong outside tests; `internal/` is a compile-time access boundary; cycles are forbidden; and `goimports` enforces a stdlib-then-everything-else grouping.

Internalise the path-vs-name distinction first; everything else follows. Run `goimports` on save and stop worrying about formatting. Use `internal/` when a package should not be public. When the compiler refuses an import, read the message — it almost always names the rule you violated.

The import block is a contract at the top of every file. It tells readers what the file depends on, and it tells the toolchain what to compile against. Treat it with the same care you treat any other public surface of your code.

---

## What You Can Build

After learning this:

- **A multi-package CLI** with `cmd/`, `internal/`, and shared sub-packages, importing across them correctly.
- **A web service** that blank-imports a SQL driver and uses `database/sql`.
- **A library** with deliberately-private internals under `internal/`, exposing only a curated public API.
- **A refactor** that breaks an existing import cycle by extracting a shared type into a new package.
- **A repository skeleton** with `goimports`-formatted import blocks throughout, ready for code review.

You cannot yet:
- Design package boundaries by responsibility (next: middle.md)
- Manage package versioning and breakage (later: 6.2.3 Publishing Modules)
- Use build tags to conditionally include imports (later)

---

## Further Reading

- [The Go Programming Language Specification — Import declarations](https://go.dev/ref/spec#Import_declarations) — the rulebook itself.
- [Go Modules Reference — Internal directories](https://go.dev/ref/mod#internal-directories) — formal definition of the `internal/` rule.
- [Effective Go — Names](https://go.dev/doc/effective_go#names) — guidance on package naming.
- [`goimports` documentation](https://pkg.go.dev/golang.org/x/tools/cmd/goimports) — install and use the formatter.
- [Dave Cheney — Should methods be declared on T or *T?](https://dave.cheney.net/) — adjacent style guidance often featuring import advice.
- [Go FAQ — How can I prevent import cycles?](https://go.dev/doc/faq#cyclic_dependencies) — short, official answer.

---

## Related Topics

- [6.1.1 `go mod init`](../../01-modules-and-dependencies/01-go-mod-init/junior.md) — creates the module that gives import paths their first segment
- [6.1.2 `go mod tidy`](../../01-modules-and-dependencies/02-go-mod-tidy/junior.md) — what fills in `go.mod` once your imports are in place
- 6.2.2 Package Naming Conventions — choosing names that match paths
- [6.2.3 Publishing Modules](../03-publishing-modules/junior.md) — how your module's import paths look to the world
- 6.2.4 Internal Packages — the `internal/` rule in depth
- 11.1 Go Toolchain — `go list`, `go vet`, and friends that operate on imports

---

## Diagrams & Visual Aids

```
Import path vs. package name:

        import "gopkg.in/yaml.v3"
                |              |
                |              +---> last segment: "yaml.v3"
                |
                +-> import path (where to find it)

        Inside the package source:
            package yaml                <-- THIS is the name you write
        Use as:
            yaml.Marshal(...)            <-- not yaml.v3.Marshal!
```

```
Import forms summary:

    import "x"               -> use as x.Foo
    import alt "x"           -> use as alt.Foo (alias)
    import _ "x"             -> not usable; runs x.init() only
    import . "x"             -> use Foo directly (DISCOURAGED)
```

```
internal/ visibility:

    github.com/alice/cool/
    |
    +-- main.go                       can import internal/db  YES
    +-- cmd/server/main.go            can import internal/db  YES
    +-- internal/
    |   `-- db/                       <-- restricted package
    +-- pkg/
        `-- public/                   can import internal/db  YES

    github.com/bob/tool/main.go       can import internal/db  NO
                                      (different module root)
```

```
Cycle that fails:

    +---+    imports     +---+
    | A | --------------> | B |
    +---+                 +---+
       ^                    |
       |       imports      |
       +--------------------+

    Fix by extracting shared types into C:

    +---+      +---+
    | A | <--- imports --- C ---> imports ---> | B |
    +---+                                       +---+
```

```
goimports grouping:

    import (
        "context"          \
        "fmt"               > group 1: stdlib
        "net/http"         /
                                      <-- exactly one blank line
        "github.com/x/y"   \
        "go.uber.org/zap"   > group 2: everything else
    )
```

```
init() order, depth-first:

    main          (last to init)
      imports A
      imports B
                    A
                      imports C
                                C   <-- inits FIRST
                              C done -> A inits
                    A done
                    B
                      imports C   <-- already done, skipped
                    B done
    main inits
    main() runs
```

```
Decision tree: which import form?

    Need to call functions from package x?
       |
       +-- Yes: import "x"
       |
       +-- Yes, but name conflicts: import alias "x"
       |
       +-- No, just need its init() to run: import _ "x"
       |
       +-- Want exported names without qualifier: import . "x"
                                                  (only in tests; usually no)
```
