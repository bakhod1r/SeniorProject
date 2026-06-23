# Go Specification: Blank Identifier

**Source:** https://go.dev/ref/spec#Blank_identifier
**Sections:** Blank identifier; Assignments; For statements; Import declarations; Variable declarations.

---

## 1. Spec Reference

| Field | Value |
|-------|-------|
| **Official Spec** | https://go.dev/ref/spec#Blank_identifier |
| **Assignments** | https://go.dev/ref/spec#Assignments |
| **Range** | https://go.dev/ref/spec#For_statements |
| **Import declarations** | https://go.dev/ref/spec#Import_declarations |
| **Variable declarations** | https://go.dev/ref/spec#Variable_declarations |
| **Predeclared identifiers** | https://go.dev/ref/spec#Predeclared_identifiers |
| **Go Version** | Go 1.0+ (always part of the language) |

Official text from the spec:

> "The blank identifier may be used as any other identifier in a declaration, but it does not introduce a binding and thus is not declared."

From "Predeclared identifiers":

> "The following identifiers are implicitly declared in the universe block:
> Types: any bool byte comparable complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr
> Constants: true false iota
> Zero value: nil
> Functions: append cap clear close complex copy delete imag len make max min new panic print println real recover
> Blank identifier: `_`"

From "Import declarations":

> "To import a package solely for its side-effects (initialization), use the blank identifier as explicit package name:
> ```
> import _ "lib/math"
> ```"

From "Assignments":

> "The blank identifier provides a way to ignore right-hand side values in an assignment."

From "For statements" (range form):

> "The iteration variables may be declared by the 'range' clause using a form of short variable declaration (:=). In this case their scope is the block of the 'for' statement and each iteration has its own new variables. The variables have the types of their respective iteration values. If a value is not needed, the corresponding identifier may be replaced with the blank identifier."

---

## 2. Definition

The **blank identifier** is the predeclared identifier `_` (a single underscore). It is special-cased by the language to be a write-only destination that introduces no binding into any scope. Every occurrence is independent; there is no continuity between separate uses.

The blank identifier appears in declarations (variable, constant, type parameter), assignment LHS positions, function parameters and results, method receivers, struct fields, range clauses, and import declarations. It is **never** allowed in expression positions; the compiler emits a "cannot use _ as value" error.

The blank identifier discards the value assigned to it. The expression on the RHS is still evaluated; the underscore does not skip computation, only the binding.

---

## 3. Core Rules & Constraints

### 3.1 No Binding

Each `_` introduces no symbol. It is not added to any scope. It cannot be referenced.

```go
var _ int = 42
fmt.Println(_) // ERROR: cannot use _ as value
```

The compiler-internal package `cmd/compile/internal/types2` skips creating a `*Object` for `_` in declarations.

### 3.2 Independence Across Occurrences

```go
_, _ := f() // INVALID — `:=` needs at least one new name
var _ int
var _ int // legal — two independent anonymous declarations
```

The two `var _ int` lines do not conflict because neither introduces a name into the scope.

### 3.3 Cannot Be Read

```go
_ = 5
fmt.Println(_) // ERROR: cannot use _ as value
```

The blank identifier is write-only by design.

### 3.4 RHS Is Still Evaluated

```go
_ = expensiveCall() // expensiveCall STILL runs
```

Only the binding is elided. Side effects of the RHS expression occur as usual.

### 3.5 Allowed in Multiple Assignment

```go
n, _ := strconv.Atoi("42")
_, err := os.Open("path")
_, _, c := f()  // discards first two of three returns
```

Each blank position is independent and accepts whatever value the RHS produces in that slot.

### 3.6 Allowed in Range Clauses

```go
for _, v := range slice { ... }
for k, _ := range m { ... }   // (the second form is unusual; prefer `for k := range m`)
for _, r := range "abc" { ... }
```

When ranging over a slice, array, map, channel, or string, the blank identifier may replace the index or the value (or both, though that is pointless).

### 3.7 Allowed as Import Name

```go
import _ "github.com/lib/pq"
```

The package is loaded; its `init` runs; no name is bound. Without `_`, an unused import is a compile error.

### 3.8 Allowed as Struct Field Name

```go
type S struct {
    A int
    _ [4]byte
    B int
}
```

Anonymous fields named `_` cannot be referenced at the source level. They contribute to size and alignment.

### 3.9 Allowed as Function Parameter, Result, or Receiver

```go
func ignore(_ int, _ string) {}
func produce() (_ int, err error) { return 0, nil }
func (_ *T) M() {}
```

These positions all accept `_` as a way of saying "no name needed".

### 3.10 Allowed as Type Parameter

```go
func F[_ any]() {}
```

Legal but useless — you cannot reference the type parameter.

### 3.11 Allowed in `var` and `const` Declarations

```go
var _ = sql.Register("postgres", &Driver{})
const _ = 1 // legal but pointless
```

The package-level `var _ = expr` form is a way to run a side-effect expression at file declaration order.

---

## 4. Edge Cases

### 4.1 Cannot Be Exported

The blank identifier has no name to export. Capitalizing the underscore is impossible. The concept of exporting `_` is meaningless.

### 4.2 No Scope

`_` does not enter any scope. There is no "outer" or "inner" `_`. Shadowing rules do not apply.

### 4.3 Multiple `_` in the Same Statement

```go
_, _ = a, b // legal: two independent anonymous slots
```

Each is its own write-only destination.

### 4.4 `_` as `var` at Package Level

```go
var _ = registerThing()
```

Runs `registerThing()` at package init time, in source declaration order. Equivalent in effect to wrapping the call in `func init()`, but tied to a specific declaration position.

### 4.5 `_` Cannot Be Addressed

```go
&_      // ERROR
_ = &x  // legal (discards the address)
```

Taking the address of `_` is meaningless because there is no storage.

### 4.6 `_` in `comma-ok` Receives

```go
v, _ := m[k]      // map lookup; discards "ok"
v, _ := x.(int)   // type assertion; discards "ok"
v, _ := <-ch      // channel receive; discards "ok"
```

The blank identifier discards the second return in any comma-ok form.

### 4.7 Short Variable Declaration with Only `_`

```go
_ := f() // ERROR: no new variables on left side of :=
```

`:=` requires at least one new non-blank name. Use `=` for a single `_` slot:

```go
_ = f()
```

### 4.8 `_` in Composite Literals

You cannot use `_` as a key or value in a composite literal:

```go
m := map[string]int{"a": _} // INVALID
```

Composite literals are expressions; `_` is not allowed in expressions.

### 4.9 `_` in Switch and Type-Switch

```go
switch v := x.(type) { ... } // legal; v shadows in cases
switch _ := x.(type) { ... } // INVALID: short decl needs a name
switch x.(type) { ... }       // legal: no binding at all
```

Use the third form when you do not need the value.

---

## 5. Examples

### 5.1 Discarding a Return

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    n, _ := strconv.Atoi("42")
    fmt.Println(n) // 42
}
```

### 5.2 Range with Discarded Index

```go
package main

import "fmt"

func main() {
    nums := []int{10, 20, 30}
    sum := 0
    for _, v := range nums {
        sum += v
    }
    fmt.Println(sum) // 60
}
```

### 5.3 Side-Effect Import

```go
package main

import (
    "database/sql"
    "log"

    _ "github.com/lib/pq"
)

func main() {
    db, err := sql.Open("postgres", "...")
    if err != nil { log.Fatal(err) }
    _ = db
}
```

### 5.4 Compile-Time Interface Assertion

```go
package mypkg

import "io"

type MyReader struct{ /* ... */ }

func (r *MyReader) Read(p []byte) (int, error) { return 0, io.EOF }

var _ io.Reader = (*MyReader)(nil)
```

### 5.5 Method Receiver Discard

```go
package main

import "fmt"

type Server struct{}

func (_ *Server) Ping() { fmt.Println("pong") }

func main() {
    s := &Server{}
    s.Ping()
}
```

### 5.6 Struct Padding

```go
package main

import (
    "fmt"
    "unsafe"
)

type CacheLineAligned struct {
    A uint64
    _ [56]byte // pad to 64
    B uint64
    _ [56]byte
}

func main() {
    fmt.Println(unsafe.Sizeof(CacheLineAligned{})) // 128
}
```

### 5.7 Package-Level Side-Effect Var

```go
package mypkg

import "database/sql"

var _ = sql.Register("mydriver", &Driver{})

type Driver struct{}
```

---

## 6. Related Specs

### 6.1 Assignments

The Assignments section lays out how the LHS list of an assignment is matched against the RHS. `_` is a legal LHS slot that consumes a value without binding it.

### 6.2 For Statements (Range Clause)

The Range clause section explicitly permits `_` in either the index or the value position.

### 6.3 Import Declarations

The Import declarations section defines the blank import: `import _ "path"`. The package is loaded for its side effect, with no names bound in the importing file.

### 6.4 Variable Declarations

`var _ T = expr` and `var _ = expr` are both valid forms. The declared "variable" is anonymous and cannot be referenced.

### 6.5 Constant Declarations

`const _ = expr` is legal but produces no usable constant. Rare in practice.

### 6.6 Type Switches

`switch x.(type)` does not require a binding; for a type switch with a binding, `switch v := x.(type)` is the canonical form. There is no `switch _ := x.(type)` because `:=` requires a new name.

### 6.7 Function and Method Declarations

Parameters, results, and receivers may all be named `_`. The receiver `_` is functionally equivalent to a named-but-unused receiver.

### 6.8 Struct Types

Field names may be `_`. Such fields contribute to size and offsets but cannot be selected.

### 6.9 Type Parameters (Go 1.18+)

Type parameter names may be `_`. The type parameter cannot be referenced inside the function body or signature, making this rare.

---

## 7. Compile Errors

Common compiler errors involving `_`:

| Code/Message | Cause | Fix |
|--------------|-------|-----|
| `cannot use _ as value` | Reading `_` in an expression | Bind to a named variable |
| `no new variables on left side of :=` | `_ := expr` with no other names | Use `var _ = expr` or `_ = expr` |
| `_ is not a value` | Trying to use `_` in expression context | Use `nil` or a real value |

The first error is by far the most common.

---

## 8. Version History

| Go Version | Change |
|-----------|--------|
| Go 1.0 | Blank identifier introduced as a predeclared identifier. All current uses (LHS of assignment, range index/value, import name, var/const declaration, struct field, function parameter/result, method receiver) date from 1.0. |
| Go 1.18 | Type parameter declarations may use `_`. (No semantic change to existing `_` uses.) |
| Go 1.22 | Loop variable scoping changed; does not affect `_` because `_` is not a binding. The pattern `for _, v := range s { go func() { use(v) }() }` now captures a fresh `v` per iteration. |

The blank identifier itself has not changed since Go 1.0. The surrounding language features that interact with it (generics, range over int, range over function — Go 1.23) treat `_` consistently with their pre-existing rules.

---

## 9. Implementation Notes

In `cmd/compile/internal/types2`:

- The identifier `_` is checked early in name resolution; if it appears in expression position, an error is produced.
- In LHS positions, `_` does not call `addObj` (the function that adds a `*Object` to a scope). Instead, the slot is recorded as anonymous.
- In assignment statements, the rhs is evaluated, the result is type-checked against the lhs slot type (if declared), and then the assignment is emitted with no destination.

In SSA (`cmd/compile/internal/ssa`):

- Assignment to `_` produces no `OpStore` or equivalent. The RHS expression is built, possibly evaluated, and the result is dropped.
- Pure-expression DCE may eliminate the entire RHS if it has no side effects.

In the linker:

- Blank-imported packages are linked normally; their `init` functions and global vars are emitted.
- The linker does not eliminate `init` even if no symbols from the package are referenced.

---

## 10. Summary

The blank identifier is one of Go's most idiomatic features. The rules:

1. **Write-only.** Cannot be read.
2. **No binding.** Each occurrence is independent.
3. **No scope.** Cannot be shadowed; cannot be addressed.
4. **RHS still evaluated.** `_ = f()` runs `f()`.
5. **Versatile.** Allowed in assignment LHS, var/const, range, struct fields, function parameters/results, method receivers, type parameters, and import names.
6. **Zero runtime cost.** Compile-time only.

These rules have been stable since Go 1.0, and the spec wording is brief and clear. Treat every `_` as a small claim of intent: "I considered this value and chose to discard it."
