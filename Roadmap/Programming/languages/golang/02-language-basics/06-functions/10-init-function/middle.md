# Go init() Function — Middle Level

## 1. Introduction

At the middle level, `init` stops being trivia ("hey, it runs before main!") and becomes a **design decision**. You learn the canonical patterns it enables (driver registries, codec registries, flag definitions, format registries), the problems it creates (testability, startup latency, hidden dependencies), and the alternatives (`sync.Once`, explicit `Setup()` functions, dependency injection).

Senior Go reviewers reject `init` for many uses where junior Go writers reach for it. This document teaches you when an `init` is correct, when it is acceptable, and when it must be replaced.

---

## 2. Prerequisites
- Junior-level init material
- Package design and imports
- `sync.Once` and basic concurrency
- Basic experience writing tests with `go test`

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Registry pattern | A central package holds a map; plugin packages register themselves in their `init` |
| Plugin package | A package whose only job is to register something during its `init` |
| Lazy initialization | Deferring expensive setup until first use, typically with `sync.Once` |
| Eager initialization | Doing setup at package-load time (in `init`) |
| Side-effect import | Same as blank import — `import _ "path"` to trigger that package's `init` |
| init coupling | A bug class where one package's `init` silently depends on another's already-run state |
| init pollution | When a library's `init` mutates global state in ways callers don't expect |

---

## 4. Real Patterns

### 4.1 Pattern: Driver Registration

Standard library `database/sql` defines a registry:

```go
// from database/sql (simplified)
var drivers = make(map[string]driver.Driver)

func Register(name string, drv driver.Driver) {
    drivers[name] = drv
}
```

Then a third-party driver registers itself:

```go
// from github.com/lib/pq
package pq

import "database/sql"

func init() {
    sql.Register("postgres", &Driver{})
}
```

User code:
```go
import (
    "database/sql"
    _ "github.com/lib/pq" // makes pq's init run, registering "postgres"
)

db, err := sql.Open("postgres", dsn)
```

**Why init is the right call here:**
- The user's `main` should not have to know about every driver that exists.
- The driver's existence is signaled at compile time by being imported.
- Registration is a one-line, fast, deterministic operation.

### 4.2 Pattern: Codec / Format Registration

`image` follows the same shape:

```go
// from image/png/reader.go (simplified)
package png

import "image"

func init() {
    image.RegisterFormat("png", "\x89PNG\r\n\x1a\n", Decode, DecodeConfig)
}
```

User:
```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
)

img, fmt, err := image.Decode(reader)
```

The user explicitly chooses which formats to bundle by which packages they blank-import. The binary stays smaller if you only blank-import what you need.

### 4.3 Pattern: Flag Definitions

Some libraries define their own flags in `init`:

```go
package logger

import "flag"

var verbose = flag.Bool("v", false, "verbose logging")

func init() {
    // var initializer above already registered the flag.
    // init can be used for default-value adjustments.
}
```

In modern code, you usually let the package-var initializer do the registration; `init` is only needed if registration depends on something computed at runtime (e.g., reading the executable's name).

Note: `flag.Parse()` belongs in `main`, never in `init`. If a library calls `flag.Parse()` in its `init`, every importer will have flags parsed at unpredictable times. This is a known anti-pattern.

### 4.4 Pattern: HTTP Handler Registration

`net/http/pprof` registers profiling endpoints in its init:

```go
// from net/http/pprof/pprof.go (simplified)
package pprof

import "net/http"

func init() {
    http.HandleFunc("/debug/pprof/", Index)
    http.HandleFunc("/debug/pprof/cmdline", Cmdline)
    http.HandleFunc("/debug/pprof/profile", Profile)
    http.HandleFunc("/debug/pprof/symbol", Symbol)
    http.HandleFunc("/debug/pprof/trace", Trace)
}
```

User:
```go
import (
    "net/http"
    _ "net/http/pprof"
)

func main() {
    http.ListenAndServe(":6060", nil)
}
```

Now `:6060/debug/pprof/` works. Critique: this also pollutes the default mux, which is one reason `expvar` and `pprof` are infamous footguns when accidentally imported in a binary that exposes its default mux to the public.

### 4.5 Pattern: Lazy Initialization with sync.Once

When the work is **expensive** (DB connect, file load, network call), prefer lazy:

```go
package store

import (
    "database/sql"
    "sync"
)

var (
    once sync.Once
    db   *sql.DB
    err  error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        db, err = sql.Open("postgres", dsn())
        if err == nil {
            err = db.Ping()
        }
    })
    return db, err
}
```

**Benefits over init:**
- Tests that don't call `store.DB()` never touch the network.
- Errors are returned, not fatal.
- Initialization cost is paid only by callers that need it.
- Cold starts (e.g., AWS Lambda) don't pay for unused subsystems.

### 4.6 Pattern: Compile-Time Validation

A great use of `init` is validating invariants of your package's data:

```go
package routes

var routes = map[string]Handler{
    "/health": healthHandler,
    "/users":  usersHandler,
}

func init() {
    for path := range routes {
        if path == "" || path[0] != '/' {
            panic("routes: invalid path " + path)
        }
    }
}
```

This panic is acceptable because:
- It catches a static programmer error, not a runtime/operator error.
- Failing fast at startup is better than later, when a request arrives.
- It cannot be triggered by user input.

---

## 5. When NOT to Use init

### 5.1 Don't Open Connections in init
```go
// BAD
func init() {
    DB = mustOpenDB(os.Getenv("DSN"))
}
```
Tests that import this package now require a live DB. CI breaks. Local dev breaks. Replace with `sync.Once` or explicit setup.

### 5.2 Don't Read Required Environment Variables
```go
// BAD
var apiKey string
func init() {
    apiKey = os.Getenv("API_KEY")
    if apiKey == "" { log.Fatal("API_KEY missing") }
}
```
Now `go test ./...` fails for any subpackage that transitively imports this. Validate environment in `main` (or in a `Config.Validate()` called from `main`).

### 5.3 Don't Touch the Filesystem
```go
// BAD
var schema []byte
func init() {
    schema = mustReadFile("/etc/myapp/schema.json")
}
```
Tests fail in containers without that file. Build a `LoadSchema(path string)` constructor.

### 5.4 Don't Spawn Goroutines
```go
// BAD
func init() {
    go backgroundReporter()
}
```
The goroutine outlives any test that imports the package. It can leak, panic, or interfere with test reporters. If you must have background work, start it from `main` or from an explicit `Start()` function with a matching `Stop()`.

### 5.5 Don't Call flag.Parse
```go
// BAD
func init() {
    flag.Parse() // affects every program that imports this!
}
```
`flag.Parse()` is global mutable state. Library inits should never call it.

### 5.6 Don't Do Anything That Can Fail Recoverably
If the work could legitimately fail and the caller might want to retry, log, or proceed in degraded mode — that work doesn't belong in `init`. `init` only failure mode is panic, which kills the program.

---

## 6. Five Worked Examples

### Example 1 — Plugin Registry

```go
// pkg/codecs/codecs.go
package codecs

type Codec interface {
    Encode([]byte) []byte
    Decode([]byte) []byte
}

var registry = map[string]Codec{}

func Register(name string, c Codec) {
    if _, dup := registry[name]; dup {
        panic("codecs: duplicate registration: " + name)
    }
    registry[name] = c
}

func Get(name string) (Codec, bool) {
    c, ok := registry[name]
    return c, ok
}
```

```go
// pkg/codecs/gzip/gzip.go
package gzip

import "yourmodule/pkg/codecs"

type codec struct{}
func (codec) Encode(b []byte) []byte { /* ... */ return b }
func (codec) Decode(b []byte) []byte { /* ... */ return b }

func init() { codecs.Register("gzip", codec{}) }
```

User:
```go
import (
    "yourmodule/pkg/codecs"
    _ "yourmodule/pkg/codecs/gzip"
)

c, _ := codecs.Get("gzip")
```

### Example 2 — Refactor Heavy Init to sync.Once

Before:
```go
var Templates = mustParse("templates/*.html")

func init() {
    if err := Templates.Compile(); err != nil { log.Fatal(err) }
}
```

After:
```go
var (
    onceTemplates sync.Once
    templates     *template.Template
    templatesErr  error
)

func Templates() (*template.Template, error) {
    onceTemplates.Do(func() {
        templates, templatesErr = template.ParseGlob("templates/*.html")
    })
    return templates, templatesErr
}
```

Tests that don't render templates pay nothing.

### Example 3 — Initialization with Dependencies

When `init` in package `A` needs data from package `B`'s package vars, that's fine — Go orders package init deepest-first. But if both packages have `init` that cross-write each other, you have a problem. Use a third coordinator package or use `sync.Once`.

### Example 4 — Validating a Map at Startup

```go
package commands

var handlers = map[string]Handler{
    "ls":   listHandler,
    "rm":   removeHandler,
    "help": helpHandler,
}

func init() {
    for name, h := range handlers {
        if h == nil {
            panic("commands: nil handler for " + name)
        }
    }
}
```

This catches programmer error at startup, not when a user types `myapp ls`.

### Example 5 — Conditional Registration

You can branch in `init`:

```go
package metrics

import (
    "os"
)

func init() {
    switch os.Getenv("METRICS_BACKEND") {
    case "prometheus":
        registerPrometheus()
    case "noop", "":
        registerNoop()
    default:
        panic("metrics: unknown backend " + os.Getenv("METRICS_BACKEND"))
    }
}
```

This is acceptable because it does not perform I/O and the env var defines a deterministic, fail-fast contract. But many teams prefer explicit `metrics.Setup()` instead so tests can pass a `noop` directly.

---

## 7. Testability Concerns

### 7.1 init Runs in Tests Too
Every `_test.go` file that imports a package triggers that package's `init`. There is no `*testing.T`-aware way to skip an init. Plan for it.

### 7.2 You Cannot Easily Test init Itself
The `init` symbol is unaddressable. You cannot call it, mock it, or replace it. The testable refactor:

```go
// BEFORE — untestable
var registry []string
func init() {
    registry = append(registry, "default")
}

// AFTER — testable
var registry []string
func setupRegistry() {
    registry = append(registry, "default")
}
func init() { setupRegistry() }
```

Now `setupRegistry` is callable from a test (resetting state first if needed).

### 7.3 Resetting init-Set State in Tests
If you need a clean slate per test:

```go
func resetForTest(t *testing.T) {
    t.Helper()
    saved := registry
    registry = nil
    t.Cleanup(func() { registry = saved })
}
```

This pattern is widely used in Go stdlib tests for global registries.

### 7.4 Side-Effect Imports in Test Binaries
Tests sometimes need extra side-effect imports:
```go
//go:build integration
package mypkg_test

import (
    _ "github.com/lib/pq" // for integration tests against real postgres
    "testing"
)
```
This is fine: the side-effect lives in the test binary only.

---

## 8. init vs Explicit Setup

| Use case | init | Explicit Setup() | sync.Once |
|---------|------|------------------|-----------|
| Driver/codec registration | YES | no | no |
| Validating static maps | YES | acceptable | no |
| Loading config from env | NO | YES | acceptable |
| Opening DB connection | NO | YES | YES |
| Parsing flags | NO (library) | YES (in main) | no |
| Starting goroutines | NO | YES | rarely |
| Lazy expensive work | no | no | YES |
| Cold-start sensitive paths | no | YES | YES |

---

## 9. Common Middle-Level Pitfalls

### 9.1 init in Library Mutates Global State
A library's `init` should not mutate **global state outside the library**. `pprof` registering on `http.DefaultServeMux` is a classic violation. Today many teams ban these libraries from production.

### 9.2 Cyclic init Logic
If you find yourself wanting package A's init to wait for B's init, your design has a cycle. The fix is usually a third package "init coordinator" or moving logic to `sync.Once`.

### 9.3 Importing for Side Effect Without Comment
```go
// BAD
import _ "github.com/lib/pq"

// GOOD
import _ "github.com/lib/pq" // postgres driver registers via init
```
The comment is essential. Without it, a future maintainer sees a "useless" import and removes it, breaking the program at runtime.

### 9.4 init Reading Mutable Globals From Other Packages
```go
// pkg b
var Now = time.Now() // initialized when?

// pkg a (imports b)
func init() {
    cutoff = b.Now.Add(-24 * time.Hour)
}
```
This works because B's vars init before A's init, but the value of `Now` is fixed at program start, which may not be what you want. Compute time-dependent values lazily.

### 9.5 Forgetting init Runs Before main
A common mistake is to set up logging in `init` but configure it from a flag in `main`:
```go
func init() {
    log.Println("starting") // logs with default config!
}
func main() {
    flag.Parse()
    log.SetOutput(...) // too late for the init log line
}
```

---

## 10. Refactor Recipes

### Recipe A: From init to Setup
```go
// before
func init() {
    DB = openDB()
}

// after
func Setup(dsn string) error {
    var err error
    DB, err = openDB(dsn)
    return err
}
```

In `main`:
```go
if err := store.Setup(cfg.DSN); err != nil { log.Fatal(err) }
```

### Recipe B: From init to sync.Once
```go
// before
var data = mustLoad()

// after
var (
    once    sync.Once
    data    Data
    dataErr error
)
func Data() (Data, error) {
    once.Do(func() { data, dataErr = load() })
    return data, dataErr
}
```

### Recipe C: Lift Validation Out of init
```go
// before
func init() { mustValidate(routes) }

// after
func Validate() error { return validate(routes) }

// caller (e.g., a TestMain)
if err := Validate(); err != nil { ... }
```

The validation still runs early, but a test can exercise it without panicking the test binary.

---

## 11. Cheat Sheet (Middle Level)

| Question | Answer |
|---------|-------|
| Best use of init? | Plugin registration in a registry (driver, codec, format) |
| Worst use of init? | Heavy I/O, env-var validation, goroutine spawn |
| How to make init testable? | Wrap body in named function, call from init AND tests |
| Replacement for heavy init? | `sync.Once` lazy or explicit `Setup()` |
| How to know an import is for side effects? | `import _ "..."` plus a comment |
| Should libraries call flag.Parse in init? | NEVER |
| Should libraries panic in init on missing env? | NO — that affects every importer |
| Order across files in a package? | Alphabetical filename, source order within file |
| Can init return error? | NO |
| Should init mutate other packages' globals? | Almost never (pprof violates this) |

You now design init usage, not just write it. The senior level descends into what the compiler and runtime actually do to make all of this work.

---

## 12. Deeper Patterns

### 12.1 The Per-Subpackage Plugin Layout

A common project layout for plugin-style code:

```
project/
  pkg/
    metrics/             # central interface + registry
      metrics.go
    metrics/prometheus/  # prometheus backend, init registers
      prometheus.go
    metrics/datadog/     # datadog backend
      datadog.go
    metrics/noop/        # noop backend
      noop.go
  cmd/
    server/main.go       # blank-imports the chosen backend
```

Switching backends is a one-line change:
```go
// production
import _ "project/pkg/metrics/prometheus"

// dev
import _ "project/pkg/metrics/noop"
```

This pattern scales beautifully because:
- Adding a new backend is purely additive.
- The central registry never changes.
- Build tags can select backends at compile time.
- Tests are explicit about what they're using.

### 12.2 Compile-Time-Only Registration

In some cases, you want a registry to be computed entirely at compile time (no runtime cost). Code generation handles this:

```go
//go:generate go run ./gen -out registry.go

// registry.go (generated)
package codecs
var registry = map[string]Codec{
    "gzip":   gzipCodec{},
    "snappy": snappyCodec{},
    "zstd":   zstdCodec{},
}
```

No init at all. The whole map is in the data segment.

Trade-off: the registry is fixed at compile time. Plugins can no longer self-register. If extensibility matters, stick with init-based registration.

### 12.3 Register-Once Idiom

Sometimes a registry needs to enforce "first registration wins" or "duplicate is error":

```go
package codecs

import "fmt"

var registry = map[string]Codec{}

func Register(name string, c Codec) {
    if _, dup := registry[name]; dup {
        panic(fmt.Sprintf("codecs: duplicate registration: %s", name))
    }
    registry[name] = c
}
```

This panic in `init` is acceptable: it indicates a programming error (someone tried to register the same name twice), which should fail loudly at startup.

### 12.4 Default Plus Override

```go
package logger

type Logger interface { Log(string) }

var current Logger = defaultLogger{}

func Set(l Logger) { current = l }

// In a plugin package:
func init() { logger.Set(myLogger{}) }
```

This is the "last writer wins" pattern. Whichever plugin's init runs last sets the logger. If two plugins are imported, you get nondeterministic behavior — usually a sign you should rethink the design and pick one logger explicitly in `main`.

---

## 13. Init in Different Project Types

### 13.1 Library Packages
- Avoid `init` if at all possible.
- If you need it, document why prominently.
- Make sure it doesn't fail under any condition that's not a programmer error.
- Make sure it doesn't depend on the environment.

### 13.2 Binary `cmd/` Packages
- More tolerable, but still review.
- `main.init` running before `main.main` is fine for setup that absolutely must precede `main`.
- Even here, prefer to have `main` call setup functions explicitly — clearer code.

### 13.3 Test-Only Packages
- `init` in `_test.go` files runs before `TestMain`.
- Useful for setting test fixture defaults, but most teams prefer `TestMain` for clarity.

### 13.4 Generated Code
- Generators sometimes emit `init` functions to register types or wire up dependencies.
- Prefer generators that produce explicit registration functions a `main`-level setup can call.

---

## 14. Compatibility Considerations

### 14.1 Adding init to an Existing Package
This is a breaking change in spirit, even if not in API:
- Importers may now pay startup cost they didn't before.
- Tests that previously passed quickly may now be slower.
- Behavior may change in subtle ways (registry contents, etc.).

Document it in the changelog and in the package doc. Consider whether the work could be deferred to first-use instead.

### 14.2 Removing init from a Package
- If callers were relying on the side effect, they'll break.
- Do this only with a major version bump and a clear migration path.

### 14.3 Reordering inits
- The Go spec only guarantees deterministic order, not stable order across compilations.
- A new toolchain version could in theory change the order.
- In practice, the `gc` toolchain has been stable, but defensive code shouldn't rely on filename order.

---

## 15. Diagnosing init Issues

### 15.1 "Why is my test slow?"

Trace the imports:
```bash
go test -v -count=1 ./pkg/under_test/ 2>&1 | head -50
```

Look for unexplained pauses at the start. Add init-timing helpers:
```go
import "time"
func init() {
    t := time.Now()
    defer func() { fmt.Printf("[init] mypkg %v\n", time.Since(t)) }()
    // ... actual init
}
```

Run tests with `-v`. The slow init shows up.

### 15.2 "Why does this fail in CI but not locally?"

Common cause: init reads an env var or file path that exists locally but not in CI. Audit:
```bash
grep -nR "func init" pkg/ | xargs -I {} sh -c 'echo "{}"; awk "/func init/,/^}/" "{}"'
```

Look for `os.Getenv`, `os.ReadFile`, network calls, panics.

### 15.3 "Why is the binary so big?"

`go tool nm` and `go list -deps`:
```bash
go list -deps ./cmd/myapp | wc -l                # how many packages
go tool nm ./cmd/myapp | awk '{print $3}' | sort -u | wc -l  # how many symbols
```

If the count seems excessive, look for over-importing. Each blank import for a side effect is paid in binary size.

---

## 16. Style Guide Recommendations

Adopt these in your team's Go style guide:

1. **Default rule: no init in libraries.** Exemptions documented per-file.
2. **Driver registration is exempt** — that's the canonical good use.
3. **No init in `cmd/` packages either, unless trivial validation.** Use `main` for setup.
4. **Every blank import has a comment.** Format: `_ "path" // brief reason for side effect`.
5. **No flag.Parse, no os.ReadFile, no net I/O in any init.**
6. **No goroutines spawned in any init.**
7. **Init bodies under 10 lines, ideally one function call.**
8. **Init body must be a one-line trampoline if testability matters:** `func init() { setupX() }`.

These rules cover 95% of init misuse. Add team-specific ones as patterns emerge.

---

## 17. Key Takeaways

- **Use init for**: deterministic, fast, no-I/O work — typically registry registration.
- **Don't use init for**: anything that reads the environment, opens connections, spawns goroutines, parses flags, or could fail recoverably.
- **Refactor heavy init to**: `sync.Once` for lazy access, or explicit `Setup()` for caller-driven setup.
- **Test init logic by**: extracting the body into a named function and calling that from both init and tests.
- **Document blank imports** with a comment explaining the side effect.
- **Watch the import graph**: every transitive import's init runs.

You're now ready for senior-level material covering the compiler and runtime mechanics that make init work the way it does.
