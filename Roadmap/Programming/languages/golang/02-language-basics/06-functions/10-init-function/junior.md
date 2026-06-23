# Go init() Function — Junior Level

## 1. Introduction

### What is it?
`init()` is a **special function** in Go that the runtime calls **automatically** before `main()` begins. You never call `init` yourself — the language guarantees it runs exactly once per package, after package-level variables are initialized but before any other code in your program.

It is the standard hook for "setup that must happen before anything else": registering a database driver, registering an image format, validating environment variables, parsing flags, building lookup tables, and so on.

### How to use it?
```go
package main

import "fmt"

var greeting = "hello"

func init() {
    fmt.Println("init runs first; greeting =", greeting)
}

func main() {
    fmt.Println("main runs second")
}
```

Output:
```
init runs first; greeting = hello
main runs second
```

You did not call `init`. The Go runtime did, automatically, after assigning `"hello"` to `greeting` and before entering `main`.

---

## 2. Prerequisites
- Functions basics (2.6.1)
- Package basics: `package` clause, importing packages
- Variable declarations at package level
- Understanding of `main` package vs library packages

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| init function | A function named `init` with no parameters and no return values that the runtime calls automatically |
| package initialization | The phase before `main` where package-level vars are assigned and `init` functions run |
| blank import | `import _ "path"` — imports a package solely for its side effects (its `init` runs) |
| side-effect import | A blank import whose only purpose is to run that package's `init` |
| init order | The deterministic sequence in which `init` functions across the program run |
| package-level vars | Variables declared at file scope outside any function |
| import graph | The directed graph of which packages import which others |
| transitive import | A package imported by something you import, not by you directly |

---

## 4. Core Concepts

### 4.1 Defining an init Function

The signature is fixed: `func init()` — no parameters, no return values, no receiver. You can define it in any file of any package.

```go
package config

import "log"

var apiKey string

func init() {
    apiKey = "loaded-from-somewhere"
    log.Println("config: init complete")
}
```

Rules at a glance:
- Name MUST be exactly `init` (lowercase).
- Signature MUST be `func init()`.
- It cannot be referenced by name in code: you cannot write `init()`, take its address, or assign it to a variable.
- It runs exactly once per package per program, no matter how many files or packages reference your package.

### 4.2 Multiple init Functions in One File

Unlike most languages with "static constructors", Go allows **as many `init` functions as you want** in a single file. They run in the order they appear in the source.

```go
package demo

import "fmt"

func init() {
    fmt.Println("init A")
}

func init() {
    fmt.Println("init B")
}

func init() {
    fmt.Println("init C")
}
```

When this package is loaded, you see:
```
init A
init B
init C
```

This is useful for grouping unrelated setup steps without forcing them into one giant function.

### 4.3 Init Order Across Files in a Package

If your package has multiple files, all `init` functions still run, in a **deterministic** order: files are presented to the compiler in alphabetical order by filename, and within each file `init` functions run top-to-bottom.

```
mypkg/
  a_setup.go      // its inits run first
  b_setup.go      // then these
  z_finalize.go   // then these
```

```go
// a_setup.go
package mypkg
import "fmt"
func init() { fmt.Println("A1") }
func init() { fmt.Println("A2") }

// b_setup.go
package mypkg
import "fmt"
func init() { fmt.Println("B1") }
```

When `mypkg` is loaded:
```
A1
A2
B1
```

Important: relying on this filename-alphabetical order in production code is fragile. The Go spec guarantees deterministic order, and current toolchains use alphabetical filename order. But cross-file init dependencies are bad design — keep each file's `init` independent.

### 4.4 Package-Level Vars Run BEFORE init

Before any `init` runs, every package-level variable is assigned its initializer. This means inside `init`, you can rely on those vars being ready.

```go
package main

import "fmt"

var greeting = makeGreeting() // runs before init

func makeGreeting() string {
    fmt.Println("var initializer")
    return "hi"
}

func init() {
    fmt.Println("init sees:", greeting)
}

func main() {
    fmt.Println("main:", greeting)
}
```

Output:
```
var initializer
init sees: hi
main: hi
```

The runtime computes a dependency graph among package vars. Vars are initialized in an order that respects those dependencies, then `init` runs.

### 4.5 Init Order Across Packages

When package `main` imports package `A`, and `A` imports `B`, the order is:
1. Package `B` initializes fully (its vars, then its inits).
2. Package `A` initializes fully (its vars, then its inits).
3. Package `main` initializes fully (its vars, then its inits).
4. `main()` runs.

So **dependencies init first, depth-first**. Each package initializes exactly once, even if imported many times. The full sequence is deterministic, not parallel.

```
main → A → B
       └── C → B (already done; skipped)
```
Result: `B`, then `C`, then `A`, then `main`, then `main.main()`.

### 4.6 Blank Imports for Side Effects

Sometimes you want a package's `init` to run, but you don't use any of its exported names. The blank identifier on an import does exactly that:

```go
package main

import (
    "database/sql"
    _ "github.com/lib/pq"   // blank import — registers the postgres driver in init
)

func main() {
    db, err := sql.Open("postgres", "...")
    _ = db
    _ = err
}
```

Without the blank import, `pq` is never imported, its `init` never runs, and `sql.Open("postgres", ...)` returns "unknown driver". This is the canonical Go pattern for plugin-style registration.

Other classic blank-import examples:
- `import _ "image/png"` — register PNG decoder with the `image` package.
- `import _ "net/http/pprof"` — install profiling endpoints on the default `http` mux.
- `import _ "embed"` — historically (now `//go:embed` directives instead).

### 4.7 init Has No Parameters and No Return

The signature is fixed:

```go
func init() { /* ... */ }            // valid
func init() error { return nil }     // INVALID — compile error
func init(args []string) { }         // INVALID — compile error
func (s Server) init() { }           // legal func, but NOT a special init
```

The last one is the trap: a method named `init` on a receiver is just a regular method. The runtime ignores it. You cannot make a method into the magic `init`.

---

## 5. Common Mistakes

### 5.1 Calling init() Yourself
```go
func init() { setup() }

func main() {
    init() // COMPILE ERROR: undefined: init
}
```
The `init` identifier is never bound in any scope you can reach. The compiler refuses.

### 5.2 Adding a Receiver
```go
type T struct{}
func (T) init() { /* will NOT run automatically */ }
```
This is just a method named `init`. It is not the magic init. Define a top-level `func init()`.

### 5.3 Returning a Value
```go
func init() error { // COMPILE ERROR
    return nil
}
```
The signature must be exactly `func init()`. Errors must be handled inside, typically by `log.Fatal` or by setting a package-level state var that callers check.

### 5.4 Heavy Work in init
```go
var DB *sql.DB

func init() {
    var err error
    DB, err = sql.Open("postgres", os.Getenv("DSN"))
    if err != nil { log.Fatal(err) }
    if err := DB.Ping(); err != nil { log.Fatal(err) } // network call!
}
```
Now every test that imports this package opens a live DB connection. Unit tests get slow and flaky. Prefer lazy initialization with `sync.Once` (covered at the middle level).

### 5.5 Order Dependencies Across Files
```go
// a.go
var Cache = buildCache(rules)
// b.go
var rules = []Rule{...}
```
This works because Go's dependency analysis sees `Cache` references `rules` and orders accordingly. But:
```go
// a.go
func init() { Cache = buildCache(rules) }
// b.go
var rules = []Rule{...}
```
Here `init` in `a.go` depends on `rules` from `b.go`. Since vars init before `init`, this still works. But:
```go
// a.go
func init() { Cache = buildCache() } // expects b's init to have run
// b.go
func init() { setupRules() }
```
Now you depend on file order. Alphabetical: `a.go` runs first, before `setupRules` sets the rules. Bug. Fix: don't have init-to-init dependencies; instead express them as package-var dependencies, or use one package per layer.

### 5.6 Panicking in init
```go
func init() {
    must(connect())
}
```
A panic in `init` aborts the program before `main` even starts. There is no `main` to `recover`. The user sees a goroutine 1 panic stack and exits with code 2. For graceful failure, return errors from a `Setup()` function called from `main`.

---

## 6. Mini Exercises

### Exercise 1 — Two Inits in One File
Write a single `main.go` with two `init` functions and `main`. Print "first", "second", "main". Verify the order.

<details><summary>Solution</summary>

```go
package main

import "fmt"

func init() { fmt.Println("first") }
func init() { fmt.Println("second") }
func main() { fmt.Println("main") }
```
</details>

### Exercise 2 — Var Then Init
Declare a package-level `var x = 10`. In `init`, print `x`. In `main`, print `x`. Both should print 10.

<details><summary>Solution</summary>

```go
package main

import "fmt"

var x = 10

func init() { fmt.Println("init:", x) }
func main() { fmt.Println("main:", x) }
```
</details>

### Exercise 3 — Side-Effect Import
Create two files: `mypkg/mypkg.go` with `func init() { fmt.Println("mypkg!") }` and `main.go` that does nothing but `import _ "yourmodule/mypkg"`. Run and confirm "mypkg!" prints.

<details><summary>Solution</summary>

```go
// mypkg/mypkg.go
package mypkg
import "fmt"
func init() { fmt.Println("mypkg!") }

// main.go
package main
import _ "yourmodule/mypkg"
func main() {}
```
Running prints `mypkg!` because the blank import forces `mypkg`'s init.
</details>

### Exercise 4 — Failed init by Removing Blank Import
Take a small program using `database/sql` with a postgres DSN, and a blank import of `github.com/lib/pq`. Remove the blank import. Observe `sql: unknown driver "postgres"`. Restore it.

### Exercise 5 — Init in Two Packages
Make package `a` import package `b`. Both have `init` functions printing their names. The `main` package imports `a`. Run and observe `b`, then `a`, then `main`.

---

## 7. Cheat Sheet

| Scenario | Code | Notes |
|---------|------|-------|
| Define init | `func init() { ... }` | No params, no return |
| Multiple inits, one file | Just declare more `func init()` | Run in source order |
| Order across files | Alphabetical filename order | Don't rely on it for logic |
| Order across packages | Imported packages first, depth-first | Each package once |
| Run an init you don't import names from | `import _ "path"` | Blank import |
| Init for `database/sql` driver | `import _ "github.com/lib/pq"` | Driver `init` calls `sql.Register` |
| Init for image decoder | `import _ "image/png"` | Decoder `init` calls `image.RegisterFormat` |
| Init signature must be | `func init()` | Anything else is not the magic init |
| Init with receiver | `func (T) init()` | This is a normal method, NOT auto-called |
| Heavy work in init | Avoid | Use `sync.Once` for lazy initialization |
| Panic in init | Aborts program | No way to recover |

### Mental Model

```
program start
  ├── load package main and recursively all imports
  ├── for each package, deepest first:
  │     ├── assign package-level vars (in dependency order)
  │     └── run init functions (in source/file order)
  └── call main.main()
```

### Common Pitfalls Recap
- "I can't add a parameter to init." Correct — fixed signature.
- "Can I call init from main?" No.
- "Can I return an error from init?" No — the signature forbids it.
- "Why do I see 'unknown driver'?" Missing blank import for the driver.
- "Why is my test slow?" Likely `init` doing heavy I/O. Refactor to `sync.Once` or explicit setup.

You now have the foundation. The middle level shows real-world patterns: registry initialization, lazy alternatives, testability, and when **not** to use `init`.

---

## 8. Extended Walkthrough — A Complete Example

Let's trace through a small program step by step so you can see exactly when everything happens.

### 8.1 The Source

```
project/
├── go.mod
├── main.go
├── greetings/
│   └── greetings.go
└── format/
    └── format.go
```

```go
// go.mod
module example/initdemo

go 1.22
```

```go
// format/format.go
package format

import "fmt"

var Prefix string

func init() {
    fmt.Println("[1] format.init: setting Prefix")
    Prefix = ">> "
}

func With(s string) string {
    return Prefix + s
}
```

```go
// greetings/greetings.go
package greetings

import (
    "fmt"
    "example/initdemo/format"
)

var greeting = format.With("hello")

func init() {
    fmt.Println("[2] greetings.init: greeting is", greeting)
}

func Greet() string {
    return greeting
}
```

```go
// main.go
package main

import (
    "fmt"
    "example/initdemo/greetings"
)

var bigPrint = func() string {
    fmt.Println("[3] main package var initializer")
    return greetings.Greet()
}()

func init() {
    fmt.Println("[4] main.init: bigPrint is", bigPrint)
}

func main() {
    fmt.Println("[5] main.main begins")
    fmt.Println("    Greet says:", greetings.Greet())
}
```

### 8.2 Predicted Output

```
[1] format.init: setting Prefix
[2] greetings.init: greeting is >> hello
[3] main package var initializer
[4] main.init: bigPrint is >> hello
[5] main.main begins
    Greet says: >> hello
```

### 8.3 Step-by-Step Trace

The runtime processes the import graph:
- `main` imports `greetings`.
- `greetings` imports `format`.
- `format` imports nothing.

Order is depth-first by post-order: `format`, then `greetings`, then `main`.

Within `format`:
1. Package vars: `Prefix` declared but its initializer is the empty string default.
2. `init` runs: prints "[1]" line, sets `Prefix = ">> "`.

Within `greetings`:
3. Package vars: `greeting = format.With("hello")` → uses `format.Prefix` (which is `">> "`) → `greeting = ">> hello"`.
4. `init` runs: prints "[2]" line.

Within `main`:
5. Package var `bigPrint` evaluates its initializer (an immediately-called function literal). Prints "[3]". Returns `greetings.Greet()` = `">> hello"`.
6. `main.init` runs: prints "[4]".
7. `main.main` runs: prints "[5]" and the greeting.

The order is rigorously determined by the rules:
- Imported packages init fully before the importer.
- Within a package, vars init before init functions.
- Package var initializers run in dependency order.

### 8.4 What Happens If You Reorder?

If you switch the order of imports in `main.go`:
```go
import (
    "example/initdemo/greetings"
    "fmt"
)
```
Nothing changes. Import order doesn't affect init order; only the import **graph** does.

If you remove `greetings` from `main.go` (but `main.go` doesn't use it), the entire `greetings` and `format` initialization sequence is gone. The binary is smaller. This is sometimes called "tree-shaking by import" — Go only links packages reachable from `main`.

If you blank-import:
```go
import _ "example/initdemo/greetings"
```
`greetings` and (transitively) `format` still init. You just don't bind `greetings` in your namespace.

---

## 9. The init "Lifecycle"

Visually:

```
[Compile time]
  - The Go compiler reads all .go files for the package.
  - It synthesizes a per-package init wrapper that:
      1. Initializes package-level vars in topological order.
      2. Calls each user-defined `func init()` in source order.
  - It records the package's import dependencies in metadata.

[Link time]
  - The linker arranges packages in dependency order.
  - It produces a binary with an `inittask` table.

[Runtime startup]
  - runtime.main():
      1. Walks the inittask table in dependency order.
      2. For each package: var init, then user init functions.
      3. Calls main.main().

[Test runtime]
  - For `go test`, the test binary is the same as a regular binary
    plus generated test scaffolding. All inits still run.
  - TestMain (if defined) runs after all inits.
```

This is why `init` is a build-time concept that manifests at runtime startup: the compiler decides, the runtime executes.

---

## 10. Frequently Asked Questions

**Q: Can `init` be in a package with no exported names?**

A: Yes — that's the whole point of side-effect-only packages. Tools like database drivers and codecs do exactly this. The package has unexported state and an `init` that mutates a global registry in a different package.

**Q: Does init run if I don't use any of the package's exports?**

A: It runs if the package is **linked** into your binary. Importing a package (even blank) links it. If you don't import it at all (directly or transitively), it doesn't run because it isn't in the binary.

**Q: What if I have `init` in two different packages and they both want to set a default?**

A: Whichever runs second wins. Since order across packages is determined by imports, you can structure it intentionally — but if they're sibling packages, the order can be unpredictable. Better: have the consumer package (the one that uses the default) define it, and let plugins override.

**Q: Can `main` call `init`?**

A: No. The `init` identifier is unbound in your scope. The compiler says `undefined: init`.

**Q: If I rename a `_test.go` file, does the init order in tests change?**

A: Possibly, since file order is what determines cross-file init order. But init in `_test.go` files participates in the same init order as `.go` files of that package's test build. Don't depend on the order.

**Q: Does `init` work in `internal` packages?**

A: Yes. `internal` is purely a visibility rule, not an init rule. Init functions in internal packages run normally.

**Q: What about `_` (underscore) functions?**

A: `_` is the blank identifier. You **cannot** name a function `_`:
```go
func _() {} // COMPILE ERROR: cannot use _ as value or type
```
But you can use `_` as a parameter name to ignore it. That's unrelated to init.

---

## 11. Drill — Predict the Output

Try to predict the output of each snippet without running it. Then verify.

### Drill 1
```go
package main
import "fmt"
var x = "X"
func init() { x = "init1:" + x }
func init() { x = "init2:" + x }
func main() { fmt.Println(x) }
```

<details><summary>Answer</summary>

`init2:init1:X` — vars first, then inits in source order, each transforms the value.
</details>

### Drill 2
```go
package main
import "fmt"
func init() { fmt.Println("a") }
var x = func() int { fmt.Println("b"); return 0 }()
func main() {}
```

<details><summary>Answer</summary>

```
b
a
```
Var initializer (with side effect via IIFE) runs before init.
</details>

### Drill 3
```go
package main
import "fmt"
var n = 10
func init() {
    if n != 10 { panic("oh no") }
    n = 20
}
func main() { fmt.Println(n) }
```

<details><summary>Answer</summary>

`20` — init verifies var, then mutates it. Main sees the post-init value.
</details>

### Drill 4
```go
// file: aa.go
package main
import "fmt"
func init() { fmt.Println("aa") }

// file: zz.go
package main
import "fmt"
func init() { fmt.Println("zz") }

// file: main.go
package main
func main() {}
```

<details><summary>Answer</summary>

```
aa
zz
```
Alphabetical filename order (current toolchain).
</details>

### Drill 5
```go
package main
import "fmt"
var greeting = compute()
func compute() string {
    fmt.Println("compute called")
    return "hello"
}
func init() { fmt.Println("init:", greeting) }
func main() { fmt.Println("main:", greeting) }
```

<details><summary>Answer</summary>

```
compute called
init: hello
main: hello
```
Var initializer (with `compute()` call) runs first, then init, then main.
</details>

If you predicted all five correctly, your mental model of init/var ordering is solid. If not, re-read sections 4 and 8 — the trace there walks through the same rules.

