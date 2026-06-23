# Go init() Function — Find the Bug

## Instructions

Each exercise contains buggy Go code involving `init`. Identify the bug, explain why it happens, and provide the corrected code. Difficulty: Easy, Medium, Hard.

---

## Bug 1 (Hard) — Goroutine Race in init

```go
package main

import (
    "fmt"
    "time"
)

var counter int

func init() {
    go func() {
        for i := 0; i < 1000; i++ {
            counter++
        }
    }()
}

func main() {
    time.Sleep(10 * time.Millisecond) // hope goroutine finished
    fmt.Println("counter:", counter)
}
```

What's wrong? Run with `-race`. What does the output look like?

<details>
<summary>Solution</summary>

**Bug**: A goroutine is spawned in `init` that mutates a package-level variable. `main` reads the same variable. There is no synchronization between them. The race detector flags this as a data race. Output of `counter` is non-deterministic — sometimes 0, sometimes 1000, sometimes a partial value.

Even worse: when `main` starts, the goroutine has not finished. The 10ms sleep is a band-aid, not a guarantee.

**Why init is the wrong place**: Spawning goroutines from init couples the package's import to spawning a worker. Every importer (including tests) gets that goroutine, with no way to opt out.

**Fix** — explicit start:
```go
package main

import (
    "fmt"
    "sync"
)

var (
    counter int
    counterMu sync.Mutex
    wg sync.WaitGroup
)

func startCounter() {
    wg.Add(1)
    go func() {
        defer wg.Done()
        for i := 0; i < 1000; i++ {
            counterMu.Lock()
            counter++
            counterMu.Unlock()
        }
    }()
}

func main() {
    startCounter()
    wg.Wait()
    counterMu.Lock()
    defer counterMu.Unlock()
    fmt.Println("counter:", counter)
}
```

**Key lesson**: Don't spawn goroutines in `init`. They have no defined lifetime relative to `main` startup, and the package author cannot synchronize across the init/main boundary.
</details>

---

## Bug 2 (Hard) — init Reading Uninitialized Cross-Package Var

```go
// pkg/a/a.go
package a

import "yourmodule/pkg/b"

var Cache map[string]int

func init() {
    Cache = map[string]int{}
    for _, k := range b.Keys {  // b.Keys may not be filled yet?
        Cache[k] = len(k)
    }
}
```

```go
// pkg/b/b.go
package b

import "yourmodule/pkg/a" // <-- circular!

var Keys = []string{"alpha", "beta", "gamma"}

func init() {
    _ = a.Cache // tries to use a's cache
}
```

```go
// main.go
package main

import _ "yourmodule/pkg/a"

func main() {}
```

What's wrong?

<details>
<summary>Solution</summary>

**Bug**: Circular import. Package `a` imports `b`, and `b` imports `a`. Go forbids this — the compiler emits `import cycle not allowed`.

**Why this is a bug class**: New developers sometimes try to break apart shared state by adding cross-imports. The compiler stops them. But subtler variants exist where you have a third package C imported by both A and B, and you assume A's init has completed when B's init runs (or vice versa). Because the import graph determines order, you can have surprising results.

**Fix** — restructure:
```go
// pkg/keys/keys.go (no imports)
package keys

var List = []string{"alpha", "beta", "gamma"}
```

```go
// pkg/a/a.go
package a

import "yourmodule/pkg/keys"

var Cache map[string]int

func init() {
    Cache = map[string]int{}
    for _, k := range keys.List {
        Cache[k] = len(k)
    }
}
```

`b` either disappears or imports `keys` directly. No cycle.

**Key lesson**: If you find yourself wanting circular imports for init coordination, the design is wrong. Extract a shared dependency package (often holding only data) and have both consumers import it.
</details>

---

## Bug 3 (Medium) — init Panic, No Recovery

```go
package main

import (
    "fmt"
    "log"
    "os"
)

func init() {
    if os.Getenv("API_KEY") == "" {
        panic("API_KEY not set")
    }
}

func main() {
    defer func() {
        if r := recover(); r != nil {
            log.Println("recovered:", r) // never runs!
        }
    }()
    fmt.Println("started")
}
```

Why doesn't `recover` catch the init panic?

<details>
<summary>Solution</summary>

**Bug**: `recover` only catches panics in the same goroutine, in a frame above the deferring function. The init panic propagates up `runtime.main`, which is **above** `main.main` in the stack. By the time control would reach the deferred recover in `main.main`, the program has already aborted with status 2.

**Why this matters**: A common misunderstanding is "I'll just defer recover in main and catch any init panic." You can't. Init failures crash the program before main is reached.

**Fix** — handle the missing key in main:
```go
package main

import (
    "fmt"
    "log"
    "os"
)

var apiKey string

func loadConfig() error {
    apiKey = os.Getenv("API_KEY")
    if apiKey == "" {
        return fmt.Errorf("API_KEY not set")
    }
    return nil
}

func main() {
    if err := loadConfig(); err != nil {
        log.Printf("config error: %v", err)
        os.Exit(1) // graceful exit code, structured log
    }
    fmt.Println("started")
}
```

**Key lesson**: Operator/environment errors should be validated in `main`, not `init`. You get clean error reporting, exit codes, and the logger fully configured.
</details>

---

## Bug 4 (Medium) — Cross-File Init Order Reliance

```go
// File: aaa_setup.go
package mypkg
import "fmt"
var registered int
func init() {
    fmt.Println("aaa init: registered =", registered)
    registered++
}
```

```go
// File: zzz_setup.go
package mypkg
import "fmt"
func init() {
    fmt.Println("zzz init: registered =", registered)
    registered++
}
```

What does this print? Why is the assumption fragile?

<details>
<summary>Solution</summary>

**Output (current Go toolchain)**:
```
aaa init: registered = 0
zzz init: registered = 1
```

**The "bug" hidden inside**: This works because the toolchain processes `aaa_setup.go` before `zzz_setup.go` (alphabetical). The Go spec guarantees **deterministic** order, but:
- It does not guarantee **alphabetical filename** order. (Older Go vesions and `gccgo` may differ.)
- A renamed file changes the order silently.
- `goimports` and IDEs sometimes reorder things.

If a developer renames `aaa_setup.go` to `setup.go`, `zzz_setup.go` may now run first, and the output flips to:
```
zzz init: registered = 0
aaa init: registered = 1
```

**Fix** — don't rely on filename order. Either:
1. Put both inits in the same file:
```go
// File: setup.go
package mypkg
import "fmt"
var registered int
func init() { fmt.Println("first init"); registered++ }
func init() { fmt.Println("second init"); registered++ }
```
This makes the order explicit and stable.

2. Use package-var dependency:
```go
var registered = 1   // initialized first
var _ = func() int { fmt.Println("after registration"); registered++; return 0 }()
```

3. Funnel through one ordered init:
```go
// File: init.go
package mypkg
func init() {
    setupA()
    setupB()
    setupC()
}
```

**Key lesson**: Multiple files with mutually dependent inits are a maintenance hazard. The Go spec gives you "deterministic" not "intuitive". Encode order explicitly.
</details>

---

## Bug 5 (Hard) — Heavy I/O in init Hangs Tests

```go
package store

import (
    "database/sql"
    _ "github.com/lib/pq"
    "log"
    "os"
)

var DB *sql.DB

func init() {
    var err error
    DB, err = sql.Open("postgres", os.Getenv("DSN"))
    if err != nil {
        log.Fatal(err)
    }
    if err := DB.Ping(); err != nil {
        log.Fatal(err)
    }
}
```

A new developer runs `go test ./...` on their laptop. They have no Postgres running. What happens?

<details>
<summary>Solution</summary>

**Bug**: Every test binary that transitively imports `store` calls `DB.Ping()`. With no DB:
- TCP connection times out (5-30 seconds default).
- `Ping` returns an error.
- `log.Fatal` exits the test binary with code 1.

The developer sees:
```
FAIL  yourmodule/some/unrelated/package  30.012s
```

It looks like an unrelated test failed. They lose hours debugging.

**Multiplied across packages**: in a 50-package project, even unrelated tests fail because they all link `store`.

**Fix** — lazy:
```go
package store

import (
    "database/sql"
    _ "github.com/lib/pq"
    "errors"
    "os"
    "sync"
)

var (
    once sync.Once
    db *sql.DB
    dbErr error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        dsn := os.Getenv("DSN")
        if dsn == "" {
            dbErr = errors.New("DSN env var not set")
            return
        }
        db, dbErr = sql.Open("postgres", dsn)
        if dbErr == nil {
            dbErr = db.Ping()
        }
    })
    return db, dbErr
}
```

Now tests that don't call `store.DB()` don't touch the network.

**Key lesson**: Heavy init becomes test-time pain. The lazy-init pattern (`sync.Once`) makes init cost pay-per-use.
</details>

---

## Bug 6 (Easy) — Multiple inits Misunderstood

```go
package main

import "fmt"

func init() {
    fmt.Println("first")
}

func init() {
    fmt.Println("second")
}

func init() {
    fmt.Println("third")
}

func main() {
    fmt.Println("main")
}
```

A developer claims this won't compile because Go only allows one init per file. Are they right?

<details>
<summary>Solution</summary>

**Verdict**: They are wrong. Go allows arbitrarily many `init` functions per file, and per package. They run in the order they appear in source.

**Output**:
```
first
second
third
main
```

**Why the misconception**: Most languages with similar features (Java's static initializers, C# constructors) have one. Go is unusual.

**Spec quote** (https://go.dev/ref/spec#Package_initialization):
> "Multiple such functions may be defined per package, even within a single source file."

**When it's useful**: separating unrelated init steps for clarity:
```go
func init() { registerDriver() }
func init() { registerCodecs() }
func init() { validateConfig() }
```

vs:
```go
func init() {
    registerDriver()
    registerCodecs()
    validateConfig()
}
```

Both work. The first is sometimes preferred for top-level grep-ability — each init can be reasoned about independently.

**Key lesson**: Multiple inits per file is legal and idiomatic. Don't refactor them into one unless there's a real reason.
</details>

---

## Bug 7 (Easy) — Trying to Test init Directly

```go
// File: registry.go
package myreg

var Items []string

func init() {
    Items = append(Items, "alpha", "beta")
}
```

```go
// File: registry_test.go
package myreg

import "testing"

func TestInit(t *testing.T) {
    Items = nil
    init() // <-- compile error
    if len(Items) != 2 {
        t.Errorf("want 2, got %d", len(Items))
    }
}
```

Why doesn't the test compile? How do you make `init`'s logic testable?

<details>
<summary>Solution</summary>

**Bug**: `init` is **not** a name in the program's scope. The compiler error is:
```
./registry_test.go:7:2: undefined: init
```

You cannot call init by name. You cannot reference it. It exists in the symbol table but is unaddressable from user code.

**Fix** — extract the body to a named function:
```go
// File: registry.go
package myreg

var Items []string

func setupRegistry() {
    Items = append(Items, "alpha", "beta")
}

func init() { setupRegistry() }
```

```go
// File: registry_test.go
package myreg

import "testing"

func TestSetup(t *testing.T) {
    Items = nil
    setupRegistry()
    if len(Items) != 2 {
        t.Errorf("want 2, got %d", len(Items))
    }
    if Items[0] != "alpha" || Items[1] != "beta" {
        t.Errorf("unexpected items: %v", Items)
    }
}
```

You can now:
- Call `setupRegistry` from tests with a known starting state.
- Reset `Items` between tests (use `t.Cleanup` to restore).
- Inject test data by parameterizing `setupRegistry` if needed.

**Key lesson**: For any init body you might need to test, factor it into a named function. The init function itself becomes a one-line trampoline.
</details>

---

## Bug 8 (Medium) — Receiver Method Named init

```go
package main

import "fmt"

type Server struct {
    name string
}

func (s *Server) init() {
    s.name = "default"
    fmt.Println("Server init")
}

var srv = &Server{}

func main() {
    fmt.Println("server name:", srv.name)
}
```

What does this print? Why?

<details>
<summary>Solution</summary>

**Output**:
```
server name:
```

**Bug**: `func (s *Server) init()` is a **method** on `*Server`. It is NOT the magic `init`. The runtime never calls it. The compiler doesn't even consider it for the init pipeline.

The empty string for `name` reflects the zero value of `string` — `init` was never invoked.

**Fix** — pick one approach:

(a) Make a true package init that initializes `srv`:
```go
type Server struct{ name string }
var srv = &Server{}
func init() { srv.name = "default" }
```

(b) Have an explicit constructor:
```go
type Server struct{ name string }
func NewServer() *Server { return &Server{name: "default"} }
var srv = NewServer()
```

(c) Make the method explicit and call it:
```go
type Server struct{ name string }
func (s *Server) Init() { s.name = "default" }
var srv = &Server{}
func init() { srv.Init() }
```

**Key lesson**: Only top-level `func init()` (no receiver) is special. Methods named `init` are silently ignored by the runtime. This is a common gotcha for developers from Java/C# backgrounds.
</details>

---

## Bug 9 (Medium) — Blank Import Removed by Tooling

```go
package main

import (
    "database/sql"
    "fmt"

    // _ "github.com/lib/pq"  // <-- accidentally removed
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil {
        fmt.Println("error:", err)
        return
    }
    _ = db
}
```

What's the runtime error?

<details>
<summary>Solution</summary>

**Error**:
```
sql: unknown driver "postgres" (forgotten import?)
```

The error is famous and the second half ("forgotten import?") is a literal hint built into `database/sql`.

**Why it happens**: `database/sql` has no built-in postgres driver. The driver registers itself in its `init`. Without the blank import, `pq.init` never runs, and `sql.Open("postgres", ...)` cannot find the driver.

**Why tooling removes it**:
- `goimports` removes unused imports. If the import is `_ "..."`, it's actually used (by side effect), and `goimports` should keep it. But buggy editor configs sometimes strip blank imports incorrectly.
- A junior developer might remove the line manually thinking it's unused.

**Fix**:
```go
import (
    "database/sql"
    "fmt"

    _ "github.com/lib/pq" // postgres driver — DO NOT REMOVE
)
```

The comment is essential. Many style guides require it for every blank import.

**Key lesson**: Blank imports are load-bearing. Always document them with a comment. Some teams enforce this with a custom lint rule that flags any uncommented blank import.
</details>

---

## Bug 10 (Hard) — flag.Parse in Library init

```go
// File: pkg/logger/logger.go
package logger

import "flag"

var verbose = flag.Bool("v", false, "verbose mode")

func init() {
    flag.Parse() // <-- bug
}
```

```go
// File: main.go
package main

import (
    _ "yourmodule/pkg/logger"
    "flag"
    "fmt"
)

var name = flag.String("name", "world", "name to greet")

func main() {
    fmt.Printf("hello %s\n", *name)
}
```

What goes wrong when you run `./prog -name=Alice`?

<details>
<summary>Solution</summary>

**Bug**: The library's `init` calls `flag.Parse()`. This happens **before** `main` has a chance to define its own flags. So when `flag.Parse` runs:
1. Only `-v` is registered (defined by the library).
2. The CLI argument `-name=Alice` is unknown.
3. `flag.Parse` calls `flag.usage` and `os.Exit(2)`.

Output:
```
flag provided but not defined: -name
Usage of ./prog:
  -v    verbose mode
exit status 2
```

The user can't even reach `main()`.

**Why `flag.Parse` doesn't belong in init**:
- It mutates global state (`flag.CommandLine`).
- It runs at an unpredictable time relative to other packages' flag definitions.
- It's a `main`-package responsibility.

**Fix** — let `main` parse:
```go
// File: pkg/logger/logger.go
package logger

import "flag"

var Verbose = flag.Bool("v", false, "verbose mode")

// no init — flag definition happens via package var initializer
```

```go
// File: main.go
package main

import (
    "yourmodule/pkg/logger"
    "flag"
    "fmt"
)

var name = flag.String("name", "world", "name to greet")

func main() {
    flag.Parse() // ONLY in main
    fmt.Printf("hello %s, verbose=%v\n", *name, *logger.Verbose)
}
```

**Key lesson**: Libraries should never call `flag.Parse`. Define flags as package vars (which auto-register on import), and let `main` parse.
</details>

---

## Bug 11 (Hard) — init Modifies Map, Concurrent Read in Goroutine

```go
package metrics

import "fmt"

var labels = map[string]string{}

func init() {
    go func() {
        for k, v := range labels { // race: read while init may still modify
            fmt.Println(k, v)
        }
    }()
    labels["host"] = "localhost"
    labels["env"] = "prod"
}
```

What's the bug? Run with `-race`.

<details>
<summary>Solution</summary>

**Bug**: The `go func()` ranges over `labels`. The init body, after the `go` statement, mutates `labels`. The race detector flags concurrent map access. Output is non-deterministic — the goroutine may see 0, 1, or 2 entries; the runtime may also panic with "concurrent map iteration and map write".

**Why init is the wrong place**: Same theme as Bug 1 — goroutines spawned in init have no defined relationship with the rest of init or with `main`.

**Fix** — defer the goroutine to main:
```go
package metrics

var labels = map[string]string{}

func init() {
    labels["host"] = "localhost"
    labels["env"] = "prod"
}

func StartReporter() {
    go func() {
        // safe — init is fully done by the time main calls this
        for k, v := range labels {
            // ...
            _ = k; _ = v
        }
    }()
}
```

In main:
```go
metrics.StartReporter()
```

**Key lesson**: A second time, with feeling: don't spawn goroutines in init. They race with init's own body and with main.
</details>

---

## Bug 12 (Medium) — init Order Across Packages Misunderstood

```go
// pkg/a/a.go
package a

import "yourmodule/pkg/b"

var Greeting = "hi from a, b says: " + b.Greeting

func init() {}
```

```go
// pkg/b/b.go
package b

var Greeting = "hi from b"

func init() {}
```

```go
// main.go
package main

import (
    "fmt"
    "yourmodule/pkg/a"
)

func main() {
    fmt.Println(a.Greeting)
}
```

A developer worries: "What if `a.Greeting` is computed before `b.Greeting`?" Reassure them with the rules.

<details>
<summary>Solution</summary>

**Reassurance**: The Go spec guarantees:
1. Imported packages init **fully** before the importer.
2. Within a package, vars init in **dependency order** (topological sort, deterministic).

So:
- `b` initializes fully first (it has no imports).
  - `b.Greeting = "hi from b"`
  - `b.init()` runs.
- Then `a` initializes:
  - `a.Greeting = "hi from a, b says: hi from b"`
  - `a.init()` runs.
- Then `main`:
  - `main.init()` (none here).
  - `main.main()` runs.

Output: `hi from a, b says: hi from b`.

**However**: the assumption only holds for **package-level vars** with **statically detectable** dependencies (like `b.Greeting` referenced directly). If `a.Greeting` were:
```go
var Greeting = computeGreeting(b.someVarSetByInit)
```
where `b.someVarSetByInit` is set inside `b`'s `init`, this still works because B's init runs before A's vars are initialized — IF the compiler can see the dependency.

The Go compiler does **whole-package analysis** and orders correctly. But cross-package dependencies that go through `init` side effects (rather than direct var refs) are not analyzed and rely solely on import order.

**Key lesson**: Direct cross-package var references are safe and ordered. Init-side-effect dependencies (init in B writes to a global that A's init reads) work via import ordering, but are fragile to refactoring.
</details>

---

## Cheat Sheet — Init Bug Patterns

| Bug | Symptom | Fix |
|-----|---------|-----|
| Goroutine in init | Race detector triggers; non-deterministic | Move to explicit `Start()` in main |
| Cross-package init dependency | Brittle; refactor breaks order | Extract shared dependency package |
| Panic in init | Program aborts before main; no recover | Validate in main |
| Cross-file init reliance | Filename rename changes behavior | Same-file inits or topo-sort vars |
| Heavy I/O in init | Tests slow/fail | `sync.Once` lazy |
| init() called explicitly | Compile error: undefined | It can't be called by name |
| Method named init | Silently ignored | Use top-level func init |
| Removed blank import | "unknown driver" runtime | Comment & lock down |
| flag.Parse in library init | CLI flags break | Move to main |
| Map race with init goroutine | Race or panic | Don't spawn from init |

These bugs cover the realistic spectrum of init misuse. Internalize the patterns: most surface in code review.
