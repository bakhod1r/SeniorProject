# Go Specification: init() and Package Initialization

**Source:** https://go.dev/ref/spec#Package_initialization
**Sections:** Package initialization, Program initialization

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Package_initialization |
| **Related** | https://go.dev/ref/spec#Program_initialization (program-level startup) |
| **Package clause** | https://go.dev/ref/spec#Package_clause |
| **Imports** | https://go.dev/ref/spec#Import_declarations |
| **Go Version** | Go 1.0+ (init introduced); Go 1.5+ formalized deterministic file order |

Official text (https://go.dev/ref/spec#Package_initialization):

> "Within a package, package-level variables are initialized in declaration order but after any of the variables they depend on.
>
> More precisely, a package-level variable is considered ready for initialization if it is not yet initialized and either has no initialization expression or its initialization expression has no dependencies on uninitialized variables. Initialization proceeds by repeatedly initializing the next package-level variable that is earliest in declaration order and ready for initialization, until there are no variables ready for initialization."
>
> "If any variables are still uninitialized when this process ends because no candidates are available then those variables are part of one or more initialization cycles, and the program is not valid."
>
> "Multiple variables on the left-hand side of a variable declaration initialized by single (multi-valued) expression on the right-hand side are initialized together: If any of the variables on the left-hand side is initialized, all those variables are initialized in the same step."
>
> "The declaration order of variables declared in multiple files is determined by the order in which the files are presented to the compiler: Variables declared in the first file are declared before any of the variables declared in the second file, and so on."
>
> "Variables may also be initialized using functions named `init` declared in the package block, with no arguments and no result parameters."
>
> ```
> func init() { ... }
> ```
>
> "Multiple such functions may be defined per package, even within a single source file. In the package block, the init identifier can be used only to declare init functions, yet the identifier itself is not declared. Thus init functions cannot be referred to from anywhere in a program."
>
> "A package with no imports is initialized by assigning initial values to all its package-level variables followed by calling all init functions in the order they appear in the source, possibly in multiple files, as presented to the compiler. If a package has imports, the imported packages are initialized before initializing the package itself. If multiple packages import a package, the imported package will be initialized only once. The importing of packages, by construction, guarantees that there can be no cyclic initialization dependencies."
>
> "Package initialization—variable initialization and the invocation of init functions—happens in a single goroutine, sequentially, one package at a time. An init function may launch other goroutines, which can run concurrently with the initialization code. However, initialization always sequences the init functions: it will not invoke the next one until the previous one has returned."

---

## 2. Definition

A package's **initialization** consists of two phases that happen in a fixed order:

1. **Variable initialization**: every package-level variable receives its initial value, in dependency order (topological sort of the dependency graph among initializers), with ties broken by source-file presentation order.
2. **`init` invocation**: every `init()` function in the package is called, in source order within a file and in file presentation order across files.

`init` is a **special function name**:
- Signature: `func init()` — exactly. No parameters, no results, no receiver.
- The identifier `init` is **not declared** in any scope. You cannot reference it from code.
- Multiple `init` functions are allowed: per file, per package, transitively across the program.
- The runtime invokes `init` automatically. User code never can.

The full program initialization order:
1. The runtime initializes itself.
2. For each package, depth-first by import graph: variables initialize, then `init`s run.
3. The `main` package's variables initialize, then its `init`s run.
4. `main.main()` is called.

---

## 3. Core Rules

### Rule 1 — Fixed Signature
```go
func init() { /* OK */ }
```
The compiler rejects any other form: `func init() error`, `func init(s string)`, `func (T) init()` (last is a method, not the magic init).

### Rule 2 — `init` Identifier Not Declared
```go
func init() {}
func main() {
    init() // COMPILE ERROR: undefined: init
}
```
You cannot call init by name, take its address, or reference it.

### Rule 3 — Multiple `init` per File
```go
func init() { /* runs first */ }
func init() { /* runs second */ }
func init() { /* runs third */ }
```
Allowed. Source order.

### Rule 4 — Multiple `init` per Package, Across Files
The order across files is the order they are **presented to the compiler**. The current `gc` toolchain presents files alphabetically. The spec does not require alphabetical, only deterministic.

### Rule 5 — Variable Initialization Precedes `init`
All package-level variables of this package are initialized **before** any of this package's `init` runs.

```go
var x = 10        // initialized first
func init() {
    fmt.Println(x) // prints 10
}
```

### Rule 6 — Imported Packages Initialize First
Each imported package fully initializes (vars + inits) before the importer's package starts. The result is a depth-first, post-order traversal of the import DAG. Each package initializes exactly once, even if multiple importers transitively bring it in.

### Rule 7 — Topological Variable Ordering
Within a package, variables are initialized in an order that respects dependencies between their initializers. Cycles are detected at compile time and produce `initialization cycle` errors.

### Rule 8 — Sequential, Single-Goroutine
Package initialization runs in a single goroutine, sequentially. Goroutines spawned by `init` may run concurrently with subsequent code, but the runtime never invokes the next `init` until the previous returns.

### Rule 9 — `init` Cannot Have Receivers
A method named `init` is just a method. It is not the magic init.

### Rule 10 — Variables on a Multi-Valued RHS Are Initialized Together
```go
var a, b = f()
```
If either is initialized, both are.

### Rule 11 — `init` Can Reference Anything in Its Package
```go
type T struct{ X int }
var t T
func init() { t.X = 42 }
```
All package-level identifiers are visible to init.

### Rule 12 — Program Failure During init
If `init` panics, the program exits with status 2. There is no opportunity to recover from outside the init's own stack.

---

## 4. Edge Cases

### 4.1 init in main Package
The `main` package's `init` is treated like any other package's. It runs after all imports' inits, before `main.main()`.

### 4.2 Blank Imports Trigger `init`
```go
import _ "image/png"
```
The blank identifier means "import for side effects only — bind no names." The package still initializes; its `init` runs. This is the canonical mechanism for plugin-style registration.

### 4.3 Multiple `init` in One File Run Sequentially
```go
func init() { panic("first") }  // aborts the program
func init() { /* never runs */ }
```
The first panic ends the program. Subsequent inits never run.

### 4.4 init and Goroutines
`init` may spawn goroutines:
```go
func init() {
    go work()
}
```
The goroutine starts but is scheduled later. Init returns immediately after the `go` statement. Subsequent inits and `main` may run concurrently with the goroutine. This is a notorious source of races and is widely considered an anti-pattern.

### 4.5 Variables With No Dependencies
Variables whose initializers have no inter-variable dependencies are initialized in source order (file presentation order, then declaration order within a file).

### 4.6 Circular Imports Forbidden
The import graph must be acyclic. The compiler enforces this. So circular init dependencies through imports are impossible.

### 4.7 init Cannot Be Inlined
The compiler does not inline init bodies. They are addressable indirectly via the init-task table.

### 4.8 init in Plugins
For `-buildmode=plugin`, the plugin's package inits run at `plugin.Open` time, in the host process. Failure surfaces as a `plugin.Open` error, not a process abort.

### 4.9 init in Test Binaries
Every test binary runs init once per process. `TestMain` runs after init, before any `Test*` function.

### 4.10 init and CGO
If a package uses cgo, the cgo `_cgo_init` and any C `__attribute__((constructor))` functions run as part of the package's init pipeline.

---

## 5. Comparison With Other Languages

| Language | Equivalent | Differences |
|---------|------------|-------------|
| Java | `static { ... }` block | Java's runs lazily on class load; Go's runs at program/test start |
| C# | static constructor | Similar — runs once per type, lazily |
| Python | top-level module code | Module code runs once; explicit calls allowed |
| C/C++ | `__attribute__((constructor))` | Similar mechanism; less standardized |
| Rust | `lazy_static!` / `OnceCell` | Explicit lazy init; no equivalent unconditional eager init |

Go's distinguishing features:
- **Multiple inits per file/package** allowed.
- **Cannot fail with error** — only panic.
- **Cannot be referenced by name** at all.
- **Eager and unconditional** — runs whether or not anything in the package is used.

---

## 6. Related Specs

### Package Clause (https://go.dev/ref/spec#Package_clause)
Defines what a package is and how files are grouped into packages.

### Import Declarations (https://go.dev/ref/spec#Import_declarations)
Defines `import` syntax, including `import _ "path"` (blank imports for side effects) and `import . "path"` (dot imports).

### Program Initialization (https://go.dev/ref/spec#Program_initialization)
Defines the program startup sequence: imports init first, then current package vars, then current package inits, then `main.main`.

### Program Execution (https://go.dev/ref/spec#Program_execution)
Defines that `main()` returns or `os.Exit` is called to terminate.

### Variable Declarations (https://go.dev/ref/spec#Variable_declarations)
Defines how package-level variables work, including multi-valued initialization.

---

## 7. Version History

### Go 1.0 (March 2012)
- `init` function introduced as part of the initial language design.
- Multiple `init`s per file allowed from day one.
- Blank imports for side effects formalized.

### Go 1.5 (August 2015)
- Toolchain refinements clarified the deterministic file order. The spec was tightened to require deterministic, but did not mandate "alphabetical".

### Go 1.7 (August 2016)
- `runtime.gopark` and scheduler refinements affecting how init-spawned goroutines behave (still anti-pattern, but observable behavior tightened).

### Go 1.10 (February 2018)
- Compiler reorganization moved init-emission code; semantics unchanged.

### Go 1.12 (February 2019)
- `inittask` representation introduced/refined in the runtime, replacing per-package `initdone` variables.

### Go 1.13 (September 2019)
- Improved error messages for init cycle detection.

### Go 1.16 (February 2021)
- `//go:embed` directive provides a compile-time alternative to file-reading inits.

### Go 1.18 (March 2022)
- Generics added; init semantics unchanged but generic packages also follow the same init order.

### Go 1.21 (August 2023)
- Built-in `min`, `max`, `clear` available; init semantics unchanged.
- `cmp.Or` and similar additions don't affect init.

### Go 1.22 (February 2024)
- Loop variable scoping changed (each iteration has its own variable). Independent of init, but affects code that uses loop closures in init bodies.

### Go 1.23+
- Continued runtime/compiler improvements; init semantics stable.

The init feature has been remarkably stable across Go versions. The spec text is essentially unchanged from 1.0; toolchain implementations have refined performance but not semantics.

---

## 8. Examples From the Spec

### Example: Variable Dependency Order
```go
var (
    a = c + b  // == 9
    b = f()    // == 4
    c = f()    // == 5
    d = 3      // == 5 after initialization has finished
)

func f() int {
    d++
    return d
}
```

Trace:
- `b` and `c` depend on `f` (and indirectly on `d`). Neither depends on the other in a way that creates a cycle.
- Order: `d=3`, then `b = f()` (returns 4, d becomes 4), then `c = f()` (returns 5, d becomes 5), then `a = c+b = 9`.
- Final: `a=9, b=4, c=5, d=5`.

### Example: Cycle
```go
var x = y + 1
var y = x + 1
```
Compile error: `initialization cycle for x`.

### Example: Multiple init in one file
```go
package main
import "fmt"
func init() { fmt.Println("init 1") }
func init() { fmt.Println("init 2") }
func main()  { fmt.Println("main") }
```
Output:
```
init 1
init 2
main
```

### Example: Cross-Package init
```go
// pkg/a/a.go
package a
import "fmt"
func init() { fmt.Println("a init") }

// pkg/b/b.go
package b
import (
    "fmt"
    _ "yourmodule/pkg/a"
)
func init() { fmt.Println("b init") }

// main.go
package main
import (
    "fmt"
    _ "yourmodule/pkg/b"
)
func init() { fmt.Println("main init") }
func main() { fmt.Println("main main") }
```
Output:
```
a init
b init
main init
main main
```

---

## 9. Implementation Notes

The Go runtime and toolchain implement init via:

- **Compiler** (`cmd/compile/internal/pkginit`): emits per-package init wrappers and tracks variable dependencies.
- **Linker**: arranges packages in dependency order in the binary's `inittask` table, wired to `runtime.firstmoduledata`.
- **Runtime** (`runtime/proc.go`): `doInit` walks the inittask table and invokes each package's init function pointer in order. Single-threaded.

Because all of this is established before `runtime.main` returns control to user code, the language guarantees about order are robust against most user errors.

---

## 10. Specification Cheat Sheet

| Question | Answer |
|---------|--------|
| Init signature? | `func init()` — no params, no return, no receiver |
| Multiple inits per file? | Yes |
| Multiple inits per package? | Yes |
| Init order within file? | Source order |
| Init order across files? | Deterministic (typically alphabetical filename) |
| Init order across packages? | Imported first, depth-first |
| Can init be called by user? | No — identifier not declared |
| Can init return error? | No |
| When do package vars init? | Before `init`, in dependency order |
| Cycles in var init? | Compile error |
| Cycles in import graph? | Compile error |
| Concurrency? | Single-goroutine, sequential |
| Init in tests? | Yes, runs in every test binary |
| Init in plugins? | Runs at `plugin.Open` time |
| Panic in init? | Aborts program with status 2 |
| Blank import effect? | Triggers package init for side effects |

The spec is short and stable. The language guarantees here are durable and worth memorizing — almost every senior Go interview tests one of them.
