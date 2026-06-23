# Go init() Function — Interview Questions

## Table of Contents
1. [Junior Level Questions](#junior-level-questions)
2. [Middle Level Questions](#middle-level-questions)
3. [Senior Level Questions](#senior-level-questions)
4. [Scenario-Based Questions](#scenario-based-questions)
5. [Trap Questions](#trap-questions)

---

## Junior Level Questions

**Q1: What is the `init()` function in Go and when does it run?**

**Answer**: `init` is a special function that the Go runtime calls automatically. It runs **before** `main()` begins, after all package-level variables are initialized. You never call it yourself — the language guarantees it runs exactly once per package.

What runs **before** `init`?
1. The runtime itself starts.
2. Package-level variables in this package and all transitively imported packages are initialized in topological/dependency order.
3. Imported packages' `init` functions run first (depth-first).
4. Then the current package's `init` runs.
5. Finally `main()` is called.

```go
package main
import "fmt"
var x = 10
func init() { fmt.Println("init, x=", x) }
func main() { fmt.Println("main, x=", x) }
```

Output:
```
init, x= 10
main, x= 10
```

---

**Q2: Can a single file have multiple `init` functions? Can a package?**

**Answer**: **Yes to both.** Go is one of the few languages that allows multiple init functions in a single file and across files of a package. They run in source order within a file, and in deterministic order across files (typically alphabetical filename order). Per the Go spec:

> "Multiple such functions may be defined per package, even within a single source file."

```go
package mypkg

func init() { /* runs first */ }
func init() { /* runs second */ }
func init() { /* runs third */ }
```

This is useful for grouping unrelated setup steps without one giant function.

---

**Q3: What is `import _ "..."` (blank import) and why is it used?**

**Answer**: A **blank import** brings a package into the program solely for its side effects — meaning, to run that package's `init` function — without binding any of its exported names.

Two real examples:

(1) **Database drivers** with `database/sql`:
```go
import (
    "database/sql"
    _ "github.com/lib/pq" // postgres driver registers via init
)
db, err := sql.Open("postgres", dsn)
```
Without the blank import, `pq.init()` doesn't run, `sql.Register("postgres", ...)` is never called, and `sql.Open` returns "unknown driver".

(2) **Image format decoders**:
```go
import (
    "image"
    _ "image/png"
    _ "image/jpeg"
)
img, fmt, err := image.Decode(reader)
```
Each blank-imported package registers a decoder via `image.RegisterFormat` in its init.

---

**Q4: What's the signature of `init`? Can it return an error?**

**Answer**: The signature is fixed: `func init()`. No parameters, no return values, no receiver. The compiler rejects any other form:

```go
func init()                  // OK
func init() error            // ERROR
func init(args []string)     // ERROR
func (T) init()              // legal method, but NOT the magic init
```

Errors must be handled inside, typically by `log.Fatal` or by setting a package-level state variable that callers check. This is a common reason teams avoid init for anything that can legitimately fail.

---

**Q5: What happens if `init` panics?**

**Answer**: The program aborts with status 2, before `main` is ever called. There is no `main` to catch the panic with a top-level `defer recover()` — by the time control would reach `main`, the program has already exited.

```go
func init() { panic("boom") }
func main() {
    defer func() { recover() }() // never runs
}
```

Output:
```
panic: boom
goroutine 1 [running]:
main.init.0()
    main.go:3 +0x...
```

Mitigation: validate config and environment in `main`, not `init`. If you must, you can `defer recover()` **inside** the `init` itself, then `log.Fatal` with a clean message.

---

**Q6: What's the order of init across packages?**

**Answer**: Imported packages initialize first, depth-first. Each package initializes exactly once.

```
main → A → B
       └── C → B (B already done; skipped)
```
Order: `B`, `C`, `A`, `main`, then `main.main()`.

Within each package: package-level variables are initialized in dependency order (topological sort with deterministic tie-breaking by source position), then `init` functions run in source order across files.

---

**Q7: Can you call `init()` directly from your code?**

**Answer**: **No.** The `init` identifier is not declared in any scope. `init()` from your code is a compile error: `undefined: init`. The runtime calls it; user code cannot.

This is intentional. Allowing manual calls would let you violate the "exactly once" guarantee.

---

## Middle Level Questions

**Q8: Why is heavy work in `init` considered an anti-pattern?**

**Answer**: Several reasons, all stemming from `init` running automatically and unconditionally:

1. **Test slowdown**: Every test binary that imports the package pays the init cost, even tests unrelated to the heavy work. A DB connect in init makes unit tests into integration tests.
2. **Cold start cost**: In serverless platforms (Lambda, Cloud Run), every cold start pays for init. Heavy init = slow user-perceived response.
3. **Failure handling**: init can only fail by panic. There's no graceful retry, fallback, or structured error handling.
4. **Testability**: init's body cannot be called or mocked. You can't write a test that verifies the work done in init without arranging the entire program startup.
5. **Determinism**: init runs unconditionally, including in `go run`, scripts, and one-shot tools where the work is wasted.

**Better alternatives**:
- `sync.Once` for lazy initialization on first use.
- Explicit `Setup(cfg Config) error` called from `main` with proper error handling.

```go
var (
    once sync.Once
    db *sql.DB
    err error
)

func DB() (*sql.DB, error) {
    once.Do(func() {
        db, err = sql.Open("postgres", dsn())
        if err == nil { err = db.Ping() }
    })
    return db, err
}
```

---

**Q9: How do you test the logic inside `init`?**

**Answer**: You can't test `init` directly — the symbol is unaddressable. The standard refactor is to extract the body into a named function and call it from both `init` and tests:

```go
// Before — untestable
var Items []string
func init() {
    Items = append(Items, "alpha", "beta")
}

// After — testable
var Items []string
func setupItems() {
    Items = append(Items, "alpha", "beta")
}
func init() { setupItems() }
```

Test:
```go
func TestSetupItems(t *testing.T) {
    Items = nil
    setupItems()
    if len(Items) != 2 { t.Errorf("got %d", len(Items)) }
}
```

For state-resetting tests, use `t.Cleanup`:
```go
func TestX(t *testing.T) {
    saved := Items
    t.Cleanup(func() { Items = saved })
    Items = nil
    setupItems()
    // ...
}
```

---

**Q10: What's the relationship between package-level variable initialization and `init` functions?**

**Answer**: Package-level variables are initialized **before** any `init` function runs in that package. Specifically, the compiler:

1. Builds a dependency graph of all package-level variables.
2. Topologically sorts the variables.
3. Initializes them in that order.
4. Then runs `init` functions in source/file order.

```go
var greeting = makeGreeting() // runs first (var initializer)
func makeGreeting() string { return "hi" }
func init() { fmt.Println(greeting) } // runs after — sees "hi"
```

This means inside `init`, all package-level vars in your package are guaranteed to have their assigned values.

---

**Q11: What's the difference between `init` and a package-level variable initializer with a function call?**

**Answer**: Both run before `main`. The differences:

- A var initializer assigns a value to a variable. It's part of the variable's declaration.
- An `init` function can do arbitrary work — including modifying many variables, calling external code, etc.

```go
// Var initializer
var x = compute() // x receives compute()'s return

// init
var y int
func init() { y = compute(); doMoreSetup() }
```

Var initializers are subject to the dependency analysis (one var's initializer can reference another's value, and the compiler orders them). `init` functions are not analyzed for what they touch — they run in deterministic source/file order, after vars.

In practice, prefer var initializers when you're computing a single value; prefer init when multiple side effects are involved.

---

**Q12: Why is it considered bad for a library's `init` to mutate `http.DefaultServeMux`?**

**Answer**: Because it has consequences for any program that imports the library, even transitively. Concretely:

- `expvar.init()` registers `/debug/vars` on the default mux.
- `net/http/pprof.init()` registers `/debug/pprof/*` on the default mux.

If a server calls `http.ListenAndServe(addr, nil)` (where `nil` means "use default mux"), it inadvertently exposes those endpoints to the world. This has caused real production security incidents — pprof endpoints exposed memory dumps, expvar leaked internal counters.

**Recommended pattern**: never use the default mux in production:
```go
mux := http.NewServeMux()
mux.HandleFunc("/", appHandler)
http.ListenAndServe(":8080", mux) // not nil!
```

If you want pprof, expose it on a separate internal port:
```go
go http.ListenAndServe("localhost:6060", nil) // pprof on internal mux
```

---

**Q13: What's the difference between `init` and a constructor (e.g., `NewX`)?**

**Answer**:
- `init` runs once per package, automatically, with no arguments and no error return.
- A constructor (`NewX`) runs each time it's called, takes parameters, and can return errors.

```go
// init: implicit, single execution, no params, no error
func init() {
    DB = openDB()
}

// constructor: explicit, called by user, has params and error return
func NewDB(dsn string) (*DB, error) {
    return openDB(dsn)
}
```

When the work needs to be configurable, fail-recoverable, or not-always-needed, prefer constructors. Use init for true package-startup invariants like driver registration.

---

## Senior Level Questions

**Q14: Walk through what the compiler emits for a package with an `init` function.**

**Answer**: For each user `init`, the compiler synthesizes a uniquely named function (historically `init.0`, `init.1`, ...). It also generates a per-package wrapper that:

1. Calls the inits of all imported packages (the linker arranges these).
2. Initializes package-level variables in topological order.
3. Calls each user `init.N` in source/file order.

The wrapper is invoked via the `runtime.inittask` mechanism. The linker emits an `inittask` per package containing the function pointers; runtime startup walks the inittasks in dependency order.

You can see the emitted symbols:
```bash
go tool nm ./bin | grep '\.init'
mypkg.init
mypkg.init.0
mypkg.init.1
```

Source paths in the Go tree:
- `cmd/compile/internal/pkginit/init.go` — emits the wrapper.
- `cmd/compile/internal/pkginit/initorder.go` — variable dependency analysis.
- `runtime/proc.go` — `doInit` walks inittasks at startup.

---

**Q15: How does `runtime.doInit` work?**

**Answer**: `doInit` walks an array of `*initTask`, one per package, in linker-determined dependency order. For each:

1. Check `state` — if 2 (done), skip.
2. If 1 (in progress), throw "linker skew" — should not happen in well-formed binaries.
3. Set `state = 1`.
4. Call each function pointer in the task (these are the package's user inits and var initializers).
5. Set `state = 2`.

Pseudo-code:
```go
func doInit1(t *initTask) {
    if t.state == 2 { return }
    if t.state == 1 { throw("recursive init") }
    t.state = 1
    for _, f := range t.fns { f() }
    t.state = 2
}
```

The whole walk is single-threaded — runtime's worker goroutines don't start until init completes. This is why goroutines spawned in init are notorious anti-patterns: they race with init's own body.

---

**Q16: Why is init order across files in a package "deterministic" but not "alphabetical" per the spec?**

**Answer**: The Go specification says only that the order is **deterministic**. Current toolchains (`gc`) implement that determinism by sorting input files alphabetically before compilation. But:

- The spec doesn't say "alphabetical". An alternate compiler (like `gccgo`) is free to use any deterministic order.
- Older Go versions used the order in which files were presented on the command line, which the build system happened to make alphabetical.
- A future Go version could legitimately change the rule.

The practical implication: don't write code that depends on a specific filename order. The rules to internalize:
- Within a file: source order.
- Across files: deterministic, but treat as opaque.
- Across packages: depth-first by import.

If your code relies on cross-file order, refactor — that dependency is fragile.

---

**Q17: How is `init` handled in plugins (`-buildmode=plugin`)?**

**Answer**: When you build a Go plugin and load it via the `plugin` package at runtime, the plugin's package inits run **at load time**, in the host process. Failure surfaces as an error from `plugin.Open`.

```go
p, err := plugin.Open("myplugin.so")
if err != nil {
    // err includes any init panic message
    log.Fatal(err)
}
```

This is the only mechanism in Go where init can run after `main` has started. Implications:
- The plugin's init can register itself with host singletons.
- A panic in plugin init does NOT crash the host — it returns an error.
- The host can load multiple plugins; each set of inits runs at its own load time.

The plumbing is the same `inittask` machinery; the runtime's plugin load code calls `doInit` on the plugin's tasks.

---

**Q18: What's the test-binary equivalent of init? What's `TestMain`?**

**Answer**: `TestMain` is the user-defined hook for test-specific setup. The order is:

1. Runtime starts.
2. Package vars init (production code + test code).
3. All `init` functions run (production code + `_test.go` code).
4. `TestMain(m *testing.M)` is called if defined.
5. Inside `TestMain`, `m.Run()` runs all `Test*` functions.
6. `os.Exit(code)` returns from `TestMain`.

```go
func TestMain(m *testing.M) {
    setup()
    code := m.Run()
    teardown()
    os.Exit(code)
}
```

Use `TestMain` for test-specific setup that should NOT be in production init: spinning up a test fixture, populating test data, etc. Use it instead of more init in `_test.go` files.

---

## Scenario-Based Questions

**Q19: A user reports that after upgrading a dependency, their tests are 10× slower. They didn't change any test code. What might be happening, init-related?**

**Answer**: A new version of the dependency may have added init-time work. Common causes:
- A new heavy import (e.g., metrics library that registers default collectors).
- A new init that opens a connection or reads a file.
- New blank-imported drivers being added to a transitively-imported package.

Investigation:
```bash
# Check what changed
go list -deps ./... | sort > new.txt
# vs the old
diff old.txt new.txt
```

Check for new packages in the list, especially ones with `init` (look at their source). The fix is usually:
- Don't import the new dependency directly if not needed.
- Or fork/patch it to make init lazy.
- Or report upstream — many maintainers will accept lazy-init PRs.

---

**Q20: You're reviewing a PR that adds `func init() { go startBackgroundReporter() }` to a library. What do you say?**

**Answer**: I'd reject and explain:

> "Library inits should not spawn goroutines. Every importer (including tests) gets the goroutine. There's no way to stop it, control its lifecycle, or test the package without it. Please replace with an explicit `func StartReporter() (stop func())` that the application's `main` calls. The application can then start it conditionally and stop it on shutdown."

If the author insists, I'd point to: Uber Go style guide ("Avoid init"), Google Go style guide ("init can make code harder to read, harder to test, and impose ordering constraints"), and the linter `gochecknoinits` which enforces this.

---

**Q21: A user reports `sql: unknown driver "postgres"`. What's the most likely cause?**

**Answer**: Missing `_ "github.com/lib/pq"` (or another postgres driver) blank import. The error message itself hints at this: it's a famous string in `database/sql` that asks "(forgotten import?)".

The fix:
```go
import _ "github.com/lib/pq"
```

This causes `pq.init()` to run, which calls `sql.Register("postgres", ...)`. Without it, the driver is never registered, and `sql.Open("postgres", ...)` cannot find it.

Always document blank imports:
```go
import _ "github.com/lib/pq" // postgres driver — DO NOT REMOVE
```

Otherwise tooling or a junior maintainer might delete the "unused" import.

---

**Q22: How would you verify in production that a particular package's init is running?**

**Answer**: Several ways:

1. **Log in init** (if you control the package):
```go
func init() { log.Println("mypkg: init complete") }
```

2. **Check the binary**:
```bash
go tool nm ./bin | grep 'mypkg\.init'
```
If the symbol exists, the init is linked. The runtime always calls all linked inits, so presence = it ran.

3. **Add an init-completion var**:
```go
var initDone bool
func init() { initDone = true }
```
Then expose `Initialized() bool { return initDone }` for diagnostics.

4. **Use `runtime/debug.PrintStack` or pprof**: not directly init-aware, but can confirm the package is reachable.

---

## Trap Questions

**Q23 (TRAP): Does `init` run before any goroutines are started?**

**Answer**: Yes — the runtime does not allow user-level goroutines to be scheduled until all package inits are complete. Specifically, `go func()` statements **inside** an init body do start goroutines, but those goroutines are only scheduled cooperatively after the spawning init returns. They run concurrently with subsequent inits and main, leading to races.

So if the question is "before user code can spawn goroutines", the answer is "init can spawn them, but can't synchronize their completion before main starts" — which is precisely the trap.

---

**Q24 (TRAP): Can `init` be called as a method on an interface?**

**Answer**: No. `init` is not a name in any scope, so it can't be referenced syntactically — let alone be a method. A type having `func (T) init()` simply has a regular method named `init`; it has no special status with the runtime.

```go
type Inter interface { init() }     // legal interface, but...
// ... no value's init method runs automatically
```

The fixed signature `func init()` (no receiver) at top level is the only form that's special. Anything else is a normal Go function or method.

---

**Q25 (TRAP): `init` is called once per package — but how many times in a multi-binary build (e.g., main + test)?**

**Answer**: Once per **process**, not once per source compilation. Each binary (the production binary, each test binary, each plugin) has its own process and its own init pipeline.

So for `go test ./...` over 50 packages, each test binary runs its own copy of every imported package's init. If your package's init is heavy, that cost multiplies by 50.

For long-running servers, a single process means a single set of inits — usually amortized to nothing. For one-shot CLIs, batch jobs, and tests, init runs frequently.

---

**Q26 (TRAP): Can you have init in a package with no other code?**

**Answer**: Yes, and it's idiomatic for "side-effect-only" packages. Example:

```go
// File: mypackage/register.go
package mypackage

import "yourmodule/registry"

func init() {
    registry.Register("foo", &fooImpl{})
}

type fooImpl struct{}
// ... methods
```

Other code blank-imports `yourmodule/mypackage` to trigger the init. This is exactly how `database/sql` drivers and `image` decoders work.

---

**Q27 (TRAP): If two `init` functions in the same file both panic, do both run?**

**Answer**: No. The first panic aborts the program. Inits run **sequentially**, in source order. If init #1 panics, init #2 never runs, and `main` never runs.

This is a reason to keep init bodies small and unlikely to fail. You can wrap an init body in `defer recover()` to convert a panic to a logged error, but the panic still has to be handled within the same init's stack.

---

## Cheat Sheet — Interview Quick Reference

| Question | One-line answer |
|---------|-----------------|
| When does init run? | After all package vars init, before main, depth-first across imports |
| Can a file have multiple inits? | Yes, in source order |
| Can a package have multiple inits? | Yes, deterministic order across files |
| init signature? | `func init()` — no params, no return, no receiver |
| Can init return error? | No |
| Can init be called manually? | No — undefined identifier |
| Does init run in tests? | Yes, in every test binary |
| Why blank import? | To run a package's init for side effects |
| Best use of init? | Driver/codec/format registration in a registry |
| Worst use of init? | I/O, env reads, flag.Parse, goroutines |
| How to test init logic? | Extract body to named function, call from init AND tests |
| Init panic → recoverable? | No — kills program before main |
| Order across packages? | Imported packages first, depth-first |
| Order across files? | Deterministic (typically alphabetical filename) |
| init vs sync.Once? | init=eager unconditional; sync.Once=lazy first-call |
