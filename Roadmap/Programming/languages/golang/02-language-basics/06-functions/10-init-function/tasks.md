# Go init() Function — Tasks

## Instructions

Each task includes a description, starter code, expected output, and an evaluation checklist. Use init idiomatically; prefer explicit setup or `sync.Once` for non-trivial work; document blank imports.

---

## Task 1 — Two Inits, Source Order

**Difficulty**: Easy
**Topic**: Multiple inits in one file

**Description**: Write a `main.go` with two `init` functions and `main`. Print "first", "second", "main" in that order.

**Starter Code**:
```go
package main

import "fmt"

// TODO: two init functions

func main() {
    fmt.Println("main")
}
```

**Expected Output**:
```
first
second
main
```

**Evaluation Checklist**:
- [ ] Two top-level `func init()` declarations
- [ ] First prints "first", second prints "second"
- [ ] No receiver, no params, no return on either init

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

func init() { fmt.Println("first") }
func init() { fmt.Println("second") }

func main() {
    fmt.Println("main")
}
```
</details>

---

## Task 2 — Var Init Before Function Init

**Difficulty**: Easy
**Topic**: Variable initialization timing

**Description**: Declare a package-level `var x = 42`. In an init function, verify `x == 42` and print "var was ready".

**Starter Code**:
```go
package main

import "fmt"

// TODO: var x and init

func main() {
    fmt.Println("done")
}
```

**Expected Output**:
```
var was ready
done
```

**Evaluation Checklist**:
- [ ] `x` is declared at package level
- [ ] `init` reads `x` and prints if it equals 42
- [ ] No assignment of x inside init

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

var x = 42

func init() {
    if x == 42 {
        fmt.Println("var was ready")
    }
}

func main() {
    fmt.Println("done")
}
```
</details>

---

## Task 3 — Driver Registration Pattern

**Difficulty**: Easy
**Topic**: Plugin registration

**Description**: Implement a tiny "codec registry". Package `codecs` has `Register(name string, c Codec)` and `Get(name string) (Codec, bool)`. Package `codecs/gzip` registers itself in init. The main program blank-imports gzip and prints whether it's available.

**Starter Code**:
```go
// codecs/codecs.go
package codecs
type Codec interface { Name() string }
// TODO: Register, Get

// codecs/gzip/gzip.go
package gzip
// TODO: init that registers a Codec

// main.go
package main
import (
    "fmt"
    "yourmodule/codecs"
    _ "yourmodule/codecs/gzip" // side-effect import
)
func main() {
    c, ok := codecs.Get("gzip")
    fmt.Println(ok, c)
}
```

**Expected Output**:
```
true gzip-codec
```

**Evaluation Checklist**:
- [ ] `codecs.Register` mutates an internal map
- [ ] `gzip.init()` calls `codecs.Register("gzip", ...)`
- [ ] Main blank-imports gzip with a comment
- [ ] `Get("gzip")` returns the registered codec

<details>
<summary>Solution</summary>

```go
// codecs/codecs.go
package codecs

type Codec interface { Name() string }

var registry = map[string]Codec{}

func Register(name string, c Codec) { registry[name] = c }

func Get(name string) (Codec, bool) {
    c, ok := registry[name]
    return c, ok
}
```

```go
// codecs/gzip/gzip.go
package gzip

import "yourmodule/codecs"

type codec struct{}

func (codec) Name() string { return "gzip-codec" }

func init() { codecs.Register("gzip", codec{}) }
```

```go
// main.go
package main

import (
    "fmt"

    "yourmodule/codecs"
    _ "yourmodule/codecs/gzip" // registers gzip in init
)

func main() {
    c, ok := codecs.Get("gzip")
    if ok {
        fmt.Println(ok, c.Name())
    }
}
```
</details>

---

## Task 4 — Refactor Heavy Init to sync.Once

**Difficulty**: Medium
**Topic**: Lazy initialization

**Description**: Take this "heavy init" code and refactor it to `sync.Once`. The before code opens a fake DB connection in init and panics on failure. The after code should defer the work to first use and return errors.

**Starter Code (before)**:
```go
package store

import (
    "errors"
    "log"
)

var DB *FakeDB

type FakeDB struct{ open bool }

func openDB() (*FakeDB, error) {
    return &FakeDB{open: true}, nil
}

func init() {
    var err error
    DB, err = openDB()
    if err != nil { log.Fatal(err) }
}
```

**Refactor To**:
```go
package store

// TODO: sync.Once + DB() function returning (*FakeDB, error)
```

**Test**:
```go
db, err := store.DB()
if err != nil { /* handle */ }
fmt.Println(db.open) // true
```

**Evaluation Checklist**:
- [ ] No `init` function
- [ ] `sync.Once` ensures one-time init
- [ ] `DB()` returns `(*FakeDB, error)`
- [ ] Subsequent calls reuse the same DB

<details>
<summary>Solution</summary>

```go
package store

import "sync"

type FakeDB struct{ open bool }

func openDB() (*FakeDB, error) {
    return &FakeDB{open: true}, nil
}

var (
    once sync.Once
    db   *FakeDB
    dbErr error
)

func DB() (*FakeDB, error) {
    once.Do(func() {
        db, dbErr = openDB()
    })
    return db, dbErr
}
```
</details>

---

## Task 5 — Demonstrate Init Order Across Packages

**Difficulty**: Medium
**Topic**: Cross-package init order

**Description**: Build three packages: `a` (no imports), `b` (imports `a`), `c` (imports `b`). Each has an init that prints its name. Main blank-imports `c`. Run and verify the order is `a, b, c, main`.

**Starter Code**:
```go
// pkg/a/a.go
package a
// TODO

// pkg/b/b.go
package b
import _ "yourmodule/pkg/a"
// TODO

// pkg/c/c.go
package c
import _ "yourmodule/pkg/b"
// TODO

// main.go
package main
import (
    "fmt"
    _ "yourmodule/pkg/c"
)
func main() { fmt.Println("main") }
```

**Expected Output**:
```
a init
b init
c init
main
```

**Evaluation Checklist**:
- [ ] Each package has an `init` printing its name
- [ ] Imports form the chain a ← b ← c
- [ ] Main blank-imports `c`

<details>
<summary>Solution</summary>

```go
// pkg/a/a.go
package a
import "fmt"
func init() { fmt.Println("a init") }
```

```go
// pkg/b/b.go
package b
import (
    "fmt"
    _ "yourmodule/pkg/a"
)
func init() { fmt.Println("b init") }
```

```go
// pkg/c/c.go
package c
import (
    "fmt"
    _ "yourmodule/pkg/b"
)
func init() { fmt.Println("c init") }
```

```go
// main.go
package main

import (
    "fmt"

    _ "yourmodule/pkg/c"
)

func main() { fmt.Println("main") }
```
</details>

---

## Task 6 — Validate Static Map in Init

**Difficulty**: Medium
**Topic**: Init for invariant checking

**Description**: A package has a map of HTTP routes. Validate in init that every key starts with `/` and every handler is non-nil. Panic if not.

**Starter Code**:
```go
package routes

type Handler func() string

var routes = map[string]Handler{
    "/health": func() string { return "ok" },
    "/users":  func() string { return "users" },
    "":        nil, // INTENTIONAL bad entry — your init should catch this
}

// TODO: init that validates
```

**Expected Behavior**: With the bad entry, the program should panic at startup. Remove the bad entry; init should pass silently.

**Evaluation Checklist**:
- [ ] init iterates the map
- [ ] Panics with a clear message identifying the bad entry
- [ ] Catches both empty path and nil handler

<details>
<summary>Solution</summary>

```go
package routes

import "fmt"

type Handler func() string

var routes = map[string]Handler{
    "/health": func() string { return "ok" },
    "/users":  func() string { return "users" },
}

func init() {
    for path, h := range routes {
        if path == "" || path[0] != '/' {
            panic(fmt.Sprintf("routes: invalid path %q", path))
        }
        if h == nil {
            panic(fmt.Sprintf("routes: nil handler for %q", path))
        }
    }
}
```
</details>

---

## Task 7 — Multiple Inits in Source Order

**Difficulty**: Medium
**Topic**: Order within a file

**Description**: In a single file, declare three init functions that build up a slice, plus a main that prints it.

**Starter Code**:
```go
package main

import "fmt"

var built []string

// TODO: three init functions, each appending one of "a", "b", "c"

func main() {
    fmt.Println(built)
}
```

**Expected Output**:
```
[a b c]
```

**Evaluation Checklist**:
- [ ] Three top-level `func init()` declarations
- [ ] Each appends one element
- [ ] Order matches source declaration

<details>
<summary>Solution</summary>

```go
package main

import "fmt"

var built []string

func init() { built = append(built, "a") }
func init() { built = append(built, "b") }
func init() { built = append(built, "c") }

func main() {
    fmt.Println(built)
}
```
</details>

---

## Task 8 — Refactor Untestable Init

**Difficulty**: Medium
**Topic**: Testability refactor

**Description**: Take a package whose init does setup. Refactor so that the setup is callable from a test. Write the test.

**Starter Code (before)**:
```go
// pkg/cfg/cfg.go
package cfg
var Items []string
func init() {
    Items = append(Items, "alpha", "beta")
}

// pkg/cfg/cfg_test.go
package cfg
// TODO: write a test that exercises the setup
```

**Refactor and write test**.

**Evaluation Checklist**:
- [ ] Setup body is in a named function
- [ ] `init` is a one-liner calling that function
- [ ] Test resets state, calls the function, asserts result
- [ ] Test uses `t.Cleanup` for state restore

<details>
<summary>Solution</summary>

```go
// pkg/cfg/cfg.go
package cfg

var Items []string

func setupItems() {
    Items = append(Items, "alpha", "beta")
}

func init() { setupItems() }
```

```go
// pkg/cfg/cfg_test.go
package cfg

import "testing"

func TestSetupItems(t *testing.T) {
    saved := Items
    t.Cleanup(func() { Items = saved })

    Items = nil
    setupItems()

    if len(Items) != 2 { t.Fatalf("got %d items, want 2", len(Items)) }
    if Items[0] != "alpha" { t.Errorf("got %q at [0]", Items[0]) }
    if Items[1] != "beta"  { t.Errorf("got %q at [1]", Items[1]) }
}
```
</details>

---

## Task 9 — Detect Missing Driver Import

**Difficulty**: Medium
**Topic**: Side-effect import requirement

**Description**: Write a small wrapper around `database/sql` that detects when a driver isn't imported. Use the error message to suggest the fix.

**Starter Code**:
```go
package db

import (
    "database/sql"
    "fmt"
)

// TODO: wrapper that calls sql.Open and converts "unknown driver" into a
// helpful error.

func Open(driver, dsn string) (*sql.DB, error) {
    return nil, nil
}
```

**Test usage**:
```go
db.Open("postgres", "...") // without _ "github.com/lib/pq"
// should return: "driver postgres not registered; missing import _ \"github.com/lib/pq\"?"
```

**Evaluation Checklist**:
- [ ] Detects "unknown driver" error from `sql.Open`
- [ ] Returns a helpful, actionable message
- [ ] Otherwise returns the underlying DB and error unchanged

<details>
<summary>Solution</summary>

```go
package db

import (
    "database/sql"
    "fmt"
    "strings"
)

var driverHint = map[string]string{
    "postgres": `_ "github.com/lib/pq"`,
    "mysql":    `_ "github.com/go-sql-driver/mysql"`,
    "sqlite":   `_ "github.com/mattn/go-sqlite3"`,
}

func Open(driver, dsn string) (*sql.DB, error) {
    db, err := sql.Open(driver, dsn)
    if err != nil && strings.Contains(err.Error(), "unknown driver") {
        if hint, ok := driverHint[driver]; ok {
            return nil, fmt.Errorf("driver %q not registered; missing import %s?", driver, hint)
        }
        return nil, fmt.Errorf("driver %q not registered: %w", driver, err)
    }
    return db, err
}
```
</details>

---

## Task 10 — Conditional Init via Build Tags

**Difficulty**: Hard
**Topic**: Compile-time init selection

**Description**: Build a logger package with two backends: stdout and file. Select via build tag. Each backend's init registers itself.

**Starter Code**:
```go
// pkg/logger/logger.go (no build tag)
package logger
type Backend interface { Log(s string) }
var current Backend
func Use(b Backend) { current = b }
func Log(s string) { if current != nil { current.Log(s) } }

// pkg/logger/stdout.go (build tag: stdout)
// TODO: init that calls Use(stdoutBackend)

// pkg/logger/file.go (build tag: file)
// TODO: init that calls Use(fileBackend)

// main.go
package main
import "yourmodule/pkg/logger"
func main() { logger.Log("hello") }
```

**Build with**: `go build -tags=stdout` or `-tags=file`.

**Evaluation Checklist**:
- [ ] Each backend file has a build tag (`//go:build stdout` or `//go:build file`)
- [ ] Each registers via init
- [ ] Without any tag, the program logs nothing (or panics — design choice)

<details>
<summary>Solution</summary>

```go
// pkg/logger/logger.go
package logger

type Backend interface { Log(s string) }

var current Backend

func Use(b Backend)   { current = b }
func Log(s string)    { if current != nil { current.Log(s) } }
```

```go
// pkg/logger/stdout.go
//go:build stdout

package logger

import "fmt"

type stdoutBackend struct{}

func (stdoutBackend) Log(s string) { fmt.Println("[stdout]", s) }

func init() { Use(stdoutBackend{}) }
```

```go
// pkg/logger/file.go
//go:build file

package logger

import (
    "fmt"
    "os"
)

type fileBackend struct{ f *os.File }

func (b fileBackend) Log(s string) { fmt.Fprintln(b.f, s) }

func init() {
    f, err := os.OpenFile("app.log", os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644)
    if err != nil { panic(err) }
    Use(fileBackend{f: f})
}
```

```go
// main.go
package main

import "yourmodule/pkg/logger"

func main() { logger.Log("hello") }
```

Build:
```
go build -tags=stdout
./prog   # [stdout] hello

go build -tags=file
./prog   # writes to app.log
```
</details>

---

## Task 11 — Avoid Init Panic Hard-Crash

**Difficulty**: Hard
**Topic**: Graceful init failure

**Description**: A package needs a config file. Currently, init reads it and panics if missing. Refactor so that the init records an error in a package var, and `main` checks and exits gracefully with a helpful message.

**Starter Code (before)**:
```go
package cfg

import (
    "log"
    "os"
)

var Settings []byte

func init() {
    var err error
    Settings, err = os.ReadFile("/etc/myapp/config.yaml")
    if err != nil { log.Fatal(err) }
}
```

**Refactor To**:
```go
package cfg
// TODO: init records error; expose a Validate() error or LoadErr var
```

**Main**:
```go
func main() {
    if err := cfg.Validate(); err != nil {
        log.Printf("config error: %v", err)
        os.Exit(1)
    }
    // ...
}
```

**Evaluation Checklist**:
- [ ] init does not panic on missing file
- [ ] Error is exposed via `Validate() error` or similar
- [ ] Main checks and exits with code 1 (not panic)
- [ ] Logger is configured before the error message

<details>
<summary>Solution</summary>

```go
// pkg/cfg/cfg.go
package cfg

import "os"

var (
    Settings []byte
    LoadErr error
)

func init() {
    Settings, LoadErr = os.ReadFile("/etc/myapp/config.yaml")
}

func Validate() error { return LoadErr }
```

```go
// main.go
package main

import (
    "log"
    "os"

    "yourmodule/pkg/cfg"
)

func main() {
    log.SetPrefix("myapp: ")
    if err := cfg.Validate(); err != nil {
        log.Printf("config error: %v", err)
        os.Exit(1)
    }
    log.Printf("config loaded (%d bytes)", len(cfg.Settings))
}
```

**Note**: Even better is to remove init entirely and have a `Load(path string) error` function called from main. But this pattern is a useful intermediate refactor when init is hard to remove.
</details>

---

## Task 12 — Time Init Cost

**Difficulty**: Hard
**Topic**: Measurement

**Description**: Add timestamps to all inits in a multi-package project. Print each init's duration. Identify the slowest.

**Hint**:
```go
import "time"

func init() {
    t := time.Now()
    defer func() {
        log.Printf("[init] mypkg took %v", time.Since(t))
    }()
    // ... actual init body
}
```

**Evaluation Checklist**:
- [ ] Each package's init is timed
- [ ] Output identifies which package is slowest
- [ ] No init is more than 10ms (or you have a justified reason)

<details>
<summary>Solution</summary>

A reusable helper:
```go
// pkg/inittiming/inittiming.go
package inittiming

import (
    "log"
    "time"
)

func Track(name string) func() {
    t := time.Now()
    return func() {
        log.Printf("[init] %s took %v", name, time.Since(t))
    }
}
```

In each package:
```go
package mypkg

import "yourmodule/pkg/inittiming"

func init() {
    defer inittiming.Track("mypkg")()
    // ... actual init body
}
```

Run:
```
[init] pkg/a took 12µs
[init] pkg/b took 1.2ms
[init] pkg/c took 8.5ms  <-- slowest, investigate
[init] main took 100µs
```
</details>

---

## Task 13 — Detect Init Order Surprise

**Difficulty**: Hard
**Topic**: Defensive design

**Description**: Build a small framework that detects when one package's init reads state that another package's init has not yet written. Use a "ready" flag pattern.

**Idea**: Each package exposes an `Initialized() bool`. Other packages' inits assert it before using the state.

**Starter Code**:
```go
// pkg/a/a.go
package a

var (
    Data []string
    initialized bool
)

func Initialized() bool { return initialized }

func init() {
    Data = []string{"x", "y"}
    initialized = true
}
```

```go
// pkg/b/b.go
package b

import (
    "yourmodule/pkg/a"
)

var Derived []string

func init() {
    if !a.Initialized() {
        panic("pkg/b init: pkg/a not yet initialized!")
    }
    for _, s := range a.Data {
        Derived = append(Derived, "B-"+s)
    }
}
```

**Evaluation Checklist**:
- [ ] `Initialized()` returns true after init completes
- [ ] Dependent packages assert before reading
- [ ] Panic message is actionable

<details>
<summary>Note</summary>

This pattern is rarely needed because Go's import-driven init order already guarantees `a`'s init runs before `b`'s (since `b` imports `a`). The exercise is about **defense in depth** — making implicit ordering explicit so a refactor that breaks the order surfaces as a clear panic instead of silent incorrect behavior.
</details>

---

## Task 14 — Init Migration Plan

**Difficulty**: Hard
**Topic**: Architecture refactor

**Description**: A legacy package has 6 inits doing varied work: registry registration, config loading, logging setup, metric registration, goroutine spawning, and FS reading. Design a migration plan that:
- Keeps the registry registration in init.
- Moves config loading to a `Setup(cfg Config) error` called from main.
- Moves logging to main.
- Replaces the goroutine with an explicit `Start/Stop` pair.
- Replaces FS reading with `//go:embed`.

Write the migration plan as comments in a `migration.md`-equivalent inside the package. Include before/after sketches.

**Evaluation Checklist**:
- [ ] Each init item is categorized (keep, refactor, remove)
- [ ] Refactored items have a target API
- [ ] No unexplained changes
- [ ] Tests can run without env vars

<details>
<summary>Sketch</summary>

```go
// migration.go
package legacy

// MIGRATION PLAN
//
// 1. Driver registration (init #1) — KEEP. Driver registration is the
//    canonical good use of init.
//
// 2. Config loading (init #2) — REFACTOR. Move to Setup(cfg Config) error.
//    Tests can pass a test config; production reads env in main.
//
// 3. Logging setup (init #3) — REMOVE from init. Configure logging in main
//    before any other call. Init logs go to default destination, which is
//    typically stderr — acceptable for fatal-only.
//
// 4. Metric registration (init #4) — KEEP if registering with a metrics
//    registry; REMOVE if it pre-fetches values from the network.
//
// 5. Goroutine spawn (init #5) — REPLACE with Start/Stop:
//      func Start(ctx context.Context) (stop func() error)
//    Caller in main: stop := legacy.Start(ctx); defer stop()
//
// 6. FS reading (init #6) — REPLACE with //go:embed:
//      //go:embed schema.json
//      var schemaJSON []byte
//
// After migration, the package has 1 init (driver registration), one
// Setup function, one Start/Stop pair, and embedded data.
```
</details>

---

## Task 15 — Comprehensive Audit Script

**Difficulty**: Extra Hard
**Topic**: Tooling

**Description**: Write a Go program that walks a project's source tree and reports every `init` function with its file path, line number, and approximate body length (lines). Flag suspicious ones (>20 lines, contains "os.Open", "http.", "Dial", "Connect", "Parse", "go ").

**Starter Code**:
```go
package main

import (
    "go/ast"
    "go/parser"
    "go/token"
    "log"
    "os"
    "path/filepath"
    "strings"
)

func main() {
    root := "."
    if len(os.Args) > 1 { root = os.Args[1] }
    // TODO
    _ = root
    _ = filepath.Walk
    _ = parser.ParseFile
    _ = token.NewFileSet
    _ = ast.FuncDecl{}
    _ = log.Println
    _ = strings.Contains
}
```

**Expected Behavior**: Walk all `.go` files (not `_test.go`), find each `init` function, print path:line, count body lines, flag suspicious ones.

**Evaluation Checklist**:
- [ ] Walks the tree, parses each file with `go/parser`
- [ ] Identifies `*ast.FuncDecl` named `init` with no receiver
- [ ] Reports body line count
- [ ] Flags suspicious patterns

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "go/ast"
    "go/parser"
    "go/token"
    "os"
    "path/filepath"
    "strings"
)

var suspicious = []string{
    "os.Open", "os.ReadFile", "http.", "Dial", "Connect",
    "flag.Parse", "go ",
}

func main() {
    root := "."
    if len(os.Args) > 1 { root = os.Args[1] }

    fset := token.NewFileSet()
    err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
        if err != nil { return err }
        if info.IsDir() { return nil }
        if !strings.HasSuffix(path, ".go") { return nil }
        if strings.HasSuffix(path, "_test.go") { return nil }

        f, err := parser.ParseFile(fset, path, nil, 0)
        if err != nil { return err }

        for _, decl := range f.Decls {
            fn, ok := decl.(*ast.FuncDecl)
            if !ok { continue }
            if fn.Name.Name != "init" || fn.Recv != nil { continue }

            startPos := fset.Position(fn.Pos())
            endPos := fset.Position(fn.End())
            lines := endPos.Line - startPos.Line + 1

            // read body text for keyword scan
            data, _ := os.ReadFile(path)
            startOff := fset.Position(fn.Pos()).Offset
            endOff := fset.Position(fn.End()).Offset
            body := string(data[startOff:endOff])

            flag := ""
            if lines > 20 { flag += " [LONG]" }
            for _, s := range suspicious {
                if strings.Contains(body, s) { flag += " [SUS:" + s + "]" }
            }

            fmt.Printf("%s:%d  init  (%d lines)%s\n",
                path, startPos.Line, lines, flag)
        }
        return nil
    })
    if err != nil { fmt.Fprintln(os.Stderr, err); os.Exit(1) }
}
```

Run:
```
$ go run tools/initaudit ./
pkg/a/a.go:5  init  (3 lines)
pkg/b/b.go:10 init  (45 lines) [LONG] [SUS:http.] [SUS:go ]
```
</details>

---

## Cheat Sheet — Tasks Summary

| Task | Topic | Key takeaway |
|------|-------|--------------|
| 1 | Multiple inits | Source order |
| 2 | Var before init | Vars init first |
| 3 | Driver registration | Canonical good init |
| 4 | sync.Once refactor | Lazy alternative |
| 5 | Cross-package order | Imports first, depth-first |
| 6 | Static validation | Acceptable init pattern |
| 7 | Three inits in source order | Builds intuition |
| 8 | Testable refactor | Extract body to named function |
| 9 | Missing driver detection | Side-effect import contract |
| 10 | Build tags | Compile-time init selection |
| 11 | No-panic config | Graceful failure pattern |
| 12 | Time inits | Measurement |
| 13 | Defensive ordering | Make implicit explicit |
| 14 | Migration plan | Architecture refactor |
| 15 | Audit script | Tooling for governance |

These tasks span from "demonstrate the basics" to "build production-grade tooling around init governance." Work through them in order; each builds on the prior.
