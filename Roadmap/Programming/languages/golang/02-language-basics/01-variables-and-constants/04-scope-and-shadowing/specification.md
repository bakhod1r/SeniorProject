# Scope and Shadowing — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Declarations_and_scope + §Blocks

---

## Table of Contents

1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar (EBNF)](#2-formal-grammar-ebnf)
3. [Core Rules & Constraints](#3-core-rules-constraints)
4. [Type Rules](#4-type-rules)
5. [Behavioral Specification](#5-behavioral-specification)
6. [Defined vs Undefined Behavior](#6-defined-vs-undefined-behavior)
7. [Edge Cases from Spec](#7-edge-cases-from-spec)
8. [Version History](#8-version-history)
9. [Implementation-Specific Behavior](#9-implementation-specific-behavior)
10. [Spec Compliance Checklist](#10-spec-compliance-checklist)
11. [Official Examples](#11-official-examples)
12. [Related Spec Sections](#12-related-spec-sections)

---

## 1. Spec Reference

### Blocks — Official Text (verbatim)

> A block is a possibly empty sequence of declarations and statements within
> matching brace brackets.

Source: https://go.dev/ref/spec#Blocks

### Implicit Blocks — Official Text (verbatim)

> In addition to explicit blocks in the source code, there are implicit blocks:
>
> 1. The **universe block** encompasses all Go source text.
> 2. Each package has a **package block** containing all Go source text for that
>    package.
> 3. Each file has a **file block** containing all Go source text in that file.
> 4. Each "if", "for", and "switch" statement is considered to be in its own
>    implicit block.
> 5. Each clause in a "switch" or "select" statement acts as an implicit block.

Source: https://go.dev/ref/spec#Blocks

### Declarations and Scope — Official Text (verbatim)

> A declaration binds a non-blank identifier to a constant, type, type
> parameter, variable, function, label, or package. Every identifier in a
> program must be declared. No identifier may be declared twice in the same
> block, and no identifier may be declared in both the file and package block.

Source: https://go.dev/ref/spec#Declarations_and_scope

### Scope — Official Text (verbatim)

> The scope of a declared identifier is the extent of source text in which the
> identifier denotes the specified constant, type, variable, function, label, or
> package.

Source: https://go.dev/ref/spec#Declarations_and_scope

### Lexical Scoping Rules — Official Text (verbatim)

> Go is lexically scoped using blocks:
>
> 1. The scope of a predeclared identifier is the universe block.
> 2. The scope of an identifier denoting a constant, type, variable, or function
>    (but not method) declared at top level (outside any function) is the
>    package block.
> 3. The scope of the package name of an imported package is the file block of
>    the file containing the import declaration.
> 4. The scope of an identifier denoting a method receiver, function parameter,
>    or result variable is the function body.
> 5. The scope of an identifier denoting a type parameter of a function or
>    declared by a method receiver begins after the name of the function and
>    ends at the end of the function body.
> 6. The scope of an identifier denoting a type parameter of a type begins after
>    the name of the type and ends at the end of the TypeSpec.
> 7. The scope of a constant or variable identifier declared inside a function
>    begins at the end of the ConstSpec or VarSpec (ShortVarDecl for short
>    variable declarations) and ends at the end of the innermost containing
>    block.
> 8. The scope of a type identifier declared inside a function begins at the
>    identifier in the TypeSpec and ends at the end of the innermost containing
>    block.

Source: https://go.dev/ref/spec#Declarations_and_scope

### Shadowing — Official Text (verbatim)

> An identifier declared in a block may be redeclared in an inner block. While
> the identifier of the inner declaration is in scope, it denotes the entity
> declared by the inner declaration.

Source: https://go.dev/ref/spec#Declarations_and_scope

---

## 2. Formal Grammar (EBNF)

### Block Grammar

```ebnf
Block         = "{" StatementList "}" .
StatementList = { Statement ";" } .
```

### Declaration Grammar

```ebnf
Declaration  = ConstDecl | TypeDecl | VarDecl .
TopLevelDecl = Declaration | FunctionDecl | MethodDecl .
```

### Statement Grammar (Scope-Relevant)

```ebnf
Statement =
    Declaration | LabeledStmt | SimpleStmt |
    GoStmt | ReturnStmt | BreakStmt | ContinueStmt | GotoStmt |
    FallthroughStmt | Block | IfStmt | SwitchStmt | SelectStmt | ForStmt .

IfStmt     = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ] .
ForStmt    = "for" [ Condition | ForClause | RangeClause ] Block .
SwitchStmt = ExprSwitchStmt | TypeSwitchStmt .
```

The spec notes: **"Each 'if', 'for', and 'switch' statement is considered to be
in its own implicit block."** This means the SimpleStmt init clause (e.g.,
`v := f()` in `if v := f(); v > 0`) lives in the implicit if-block, not in
the surrounding block.

---

## 3. Core Rules & Constraints

### Rule 1 — No Duplicate Declarations in the Same Block

> "No identifier may be declared twice in the same block."

```go
func f() {
    x := 1
    // x := 2  // compile error: no new variables on left side of :=
    x = 2     // OK: assignment, not declaration
    _ = x
}
```

### Rule 2 — No Declaration in Both File and Package Block

An identifier cannot be declared in both the file block (e.g., via an import
alias) and the package block (e.g., as a top-level variable). This prevents
ambiguity at the file scope.

### Rule 3 — Shadowing Is Legal in Inner Blocks

Declaring an identifier in an inner block that already exists in an outer block
is **legal**. The inner declaration shadows the outer one for the duration of
the inner block.

### Rule 4 — Scope Begins After Declaration

For variables inside functions (Rule 7 above), the scope begins **at the end
of the VarSpec or ShortVarDecl**, not at the beginning of the enclosing block.
This means a variable is not in scope before its declaration on the same line.

### Rule 5 — init Clause Variable Visible in else

A variable declared in the init clause of an `if` statement (`if x := f(); ...`)
is visible in **both** the `if` body and the `else` body, because both are part
of the same implicit if-block.

### Rule 6 — Labels Are Not Block-Scoped

The spec notes: "labels are not block scoped and do not conflict with
identifiers that are not labels." Labels have function-wide scope.

### Rule 7 — Blank Identifier Does Not Bind

The blank identifier `_` can appear in any declaration but does not introduce a
binding. It is therefore never in scope and cannot be referred to by name.

---

## 4. Type Rules

### Shadowing and Types

When an identifier is shadowed in an inner block, the inner variable may have
a **different type** from the outer variable. The two are completely independent
variables:

```go
var x int = 10
{
    var x string = "hello"  // x is now string in this block
    _ = x                   // x is the inner string
}
// x is int again here
```

### Type Assertion Shadowing Pattern

A common Go pattern uses `:=` in a type assertion to shadow an interface
variable with its concrete type:

```go
var v interface{} = "hello"
if v, ok := v.(string); ok {
    // v is now string, shadowing the outer interface{} v
    fmt.Println(v) // "hello"
}
// v is interface{} again here
```

### Short Declaration in if-init Creates New-Typed Variable

```go
if err := doSomething(); err != nil {
    // err is *MyError or whatever doSomething returns
}
// err is NOT in scope here — it only lives in the if implicit block
```

---

## 5. Behavioral Specification

### Block Hierarchy

The Go spec defines the following block hierarchy from broadest to narrowest:

```
Universe Block
  └── Package Block
        └── File Block
              └── Function Body Block
                    └── Local Block (if/for/switch implicit block)
                          └── Nested Local Block
```

**Universe block**: Contains all predeclared identifiers (`true`, `false`,
`nil`, `int`, `string`, `make`, `len`, etc.).

**Package block**: Contains all package-level declarations (functions, types,
variables, constants declared outside any function).

**File block**: Contains import declarations. Each file has its own file block.
Import names are only visible within their file.

**Function body block**: Contains function parameters, result variables, and
the function body. Method receiver is also scoped here.

**Local / implicit block**: `if`, `for`, `switch` statements each introduce an
implicit block. Variables declared in their init clause live in this block.

### When Scope Begins

| Declaration Kind | Scope Begins |
|-----------------|-------------|
| Predeclared identifiers | Universe block (always in scope) |
| Package-level declarations | Package block (entire package) |
| Imports | File block (entire file) |
| Function parameters / return values | Function body |
| `var x = expr` inside function | After the `=` (end of VarSpec) |
| `x := expr` inside function | After the `:=` (end of ShortVarDecl) |
| Type inside function | At the identifier in the TypeSpec |

### Shadowing Does Not Modify the Outer Variable

When an identifier is shadowed, the outer variable is **not modified**. The
inner block creates an entirely new variable with the same name. When the inner
block ends, the outer variable resumes its role:

```go
x := 10
{
    x := 20   // new variable, shadows outer x
    x = 25    // modifies inner x
    _ = x
}
fmt.Println(x) // Output: 10 — outer x unchanged
```

---

## 6. Defined vs Undefined Behavior

### Defined — Legal Scope Operations

| Operation | Behavior |
|-----------|----------|
| Declaring same identifier in inner block | Legal — shadows outer; outer unchanged |
| Using identifier before its declaration in same block | **Compile error** |
| Using identifier after the block it was declared in ends | **Compile error** — out of scope |
| Import alias shadowing package-level name | Legal (but poor style) |
| `if v := f(); v > 0 { }` | v in scope throughout entire if-else |
| Predeclared identifier (e.g., `len`) shadowed locally | Legal (but extremely poor style) |

### Illegal / Compile-Time Errors

| Operation | Result |
|-----------|--------|
| Declaring same identifier twice in the same block | **Compile error** |
| Using an undeclared identifier | **Compile error** |
| Declaring in both file and package block | **Compile error** |
| Referring to `_` by name | **Compile error** — blank identifier not accessible |
| Using a variable declared in an if-init after the if statement | **Compile error** — out of scope |

---

## 7. Edge Cases from Spec

### Edge Case 1 — if-init Variable Visible in else

The spec states that `if` and `else` form a single implicit block. A variable
declared in the if-init clause is visible in the `else` block:

```go
if v, ok := someMap["key"]; ok {
    fmt.Println("found:", v)
} else {
    fmt.Println("not found, v =", v) // v is in scope here too!
}
// v is NOT in scope here
```

### Edge Case 2 — Short Declaration in Inner Scope Creates New Variable

Using `:=` in an inner block always creates a **new** variable, even if an
identifier with that name exists in the outer scope (because redeclaration via
`:=` only works within the **same** block):

```go
x := 10
if true {
    x := 20     // NEW variable — inner block, not a redeclaration of outer x
    fmt.Println(x) // 20
}
fmt.Println(x) // 10 — outer x unchanged
```

### Edge Case 3 — for Range Variable Scope (Go 1.22+)

Before Go 1.22, the loop variable in a `for range` was a single variable
reused across iterations. Starting from Go 1.22, each iteration gets its own
copy of the loop variable:

```go
// Go 1.22+: each closure captures its own copy
funcs := make([]func(), 3)
for i := range 3 {
    funcs[i] = func() { fmt.Println(i) }
}
funcs[0]() // 0
funcs[1]() // 1
funcs[2]() // 2
// Pre-1.22: all would print 3 (or 2, depending on loop variable value at end)
```

### Edge Case 4 — Scope of Variable on Left Side of :=

The scope of a variable declared by `:=` begins **after** the `:=` expression.
This means the right-hand side expression can reference an outer variable of
the same name:

```go
x := 1
x := x + 1  // illegal in same block (x already declared)

// But in a new block:
x := 1
{
    x := x + 1  // legal: right-hand 'x' is the outer x (scope of new x starts after :=)
    fmt.Println(x) // 2
}
fmt.Println(x) // 1
```

### Edge Case 5 — Shadowing Predeclared Identifiers

The spec permits shadowing predeclared identifiers (those in the universe
block). This is almost always a mistake:

```go
func example() {
    // Shadowing predeclared 'len' — legal but terrible practice
    len := func(s string) int { return 0 }
    fmt.Println(len("hello")) // 0 — uses our local len, not builtin
}
```

### Edge Case 6 — Switch Statement Implicit Block

Each `case` clause in a `switch` has its own implicit block. Variables
declared in one case are not visible in other cases:

```go
switch x := getValue(); x {
case 1:
    y := "one"
    fmt.Println(y)
    // y is in scope here
case 2:
    // y is NOT in scope here (different implicit block)
    fmt.Println("two")
}
// x is NOT in scope here (x lives in the switch implicit block)
```

### Edge Case 7 — Function Parameter Scope

Function parameters and named return values are scoped to the entire function
body. They can be shadowed by variables declared inside the function:

```go
func process(n int) (result int) {
    // n and result are in scope throughout the function
    if n > 0 {
        n := n * 2   // new n in if block, shadows parameter n
        result = n   // uses inner n
    }
    return // named return: returns result (modified in if block)
}
```

### Edge Case 8 — Package Level Identifier Cannot Use :=

Package-level declarations cannot use `:=`. All top-level declarations must
use `var`, `const`, `type`, or `func`:

```go
package main

x := 5 // compile error: non-declaration statement outside function body

var x = 5 // OK
```

---

## 8. Version History

| Go Version | Scope / Block Change |
|------------|---------------------|
| Go 1.0 | Lexical block scoping established. Universe, package, file, function, and local block hierarchy defined. |
| Go 1.0 | Short declaration `:=` redeclaration semantics (same-block only) established. |
| Go 1.18 | Generics added type parameter scoping rules (Rules 5 and 6 in the Declarations and scope section). |
| Go 1.22 | **Loop variable scoping changed**: each iteration of a `for` loop now has its own copy of the loop variable. Previously all iterations shared one variable, leading to closure capture bugs. |

---

## 9. Implementation-Specific Behavior

### Dead Code and Scope

The `gc` compiler enforces the "declared and not used" rule for all variables
in function bodies, regardless of block nesting. Even variables in inner blocks
that are always reached must be used.

### Shadow Detection Tooling

Go does not build shadow detection into the compiler (it is not a spec
requirement). However, the `go vet` tool and third-party linters (e.g.,
`staticcheck`, `shadow` analyzer) can detect shadowed variables as a style
warning.

To run the shadow analyzer:

```bash
go install golang.org/x/tools/go/analysis/passes/shadow/cmd/shadow@latest
shadow ./...
```

### Variable Escape Analysis and Scope

The compiler's escape analysis determines whether a variable is allocated on
the stack or heap. Scope affects escape analysis: a variable that outlives its
stack frame (e.g., its address is taken and returned) escapes to the heap.
This is implementation-specific and does not affect the observable behavior
guaranteed by the spec.

---

## 10. Spec Compliance Checklist

- [ ] No identifier is declared twice in the same block
- [ ] No identifier is declared in both the file block and package block
- [ ] `:=` redeclaration only used within the same block (not across blocks)
- [ ] Variables declared in if-init are not used outside the if-else
- [ ] Variables declared in for-init are not used outside the for loop
- [ ] Shadowed variables are intentional (or flagged for review)
- [ ] Predeclared identifiers (len, make, etc.) are not accidentally shadowed
- [ ] Package-level declarations use `var`/`const`/`type`/`func`, never `:=`
- [ ] Named return values are not accidentally shadowed in function body
- [ ] In Go 1.22+, loop variable capture in closures works as expected (each iteration has own copy)
- [ ] Labels are not confused with variable declarations (different scoping rules)

---

## 11. Official Examples

### Block Hierarchy Demonstration

```go
package main

import "fmt"

// Package block: x is visible throughout the package
var x = "package"

func main() {
    // Function block: y is visible throughout main
    y := "function"
    fmt.Println(x, y) // Output: package function

    // Local block 1
    {
        // Inner block: x shadows package-level x
        x := "inner-block" // new variable, shadows package x
        fmt.Println(x, y)  // Output: inner-block function
    }

    // Back to function block: package x is visible again
    fmt.Println(x) // Output: package
}
```

### Shadowing with if/else

```go
package main

import "fmt"

func lookup(m map[string]int, key string) {
    // v and ok are declared in the implicit if block
    // Both are visible in the if body AND the else body
    if v, ok := m[key]; ok {
        fmt.Printf("found %s = %d\n", key, v)
    } else {
        fmt.Printf("key %q not found (v = %d)\n", key, v)
        // v is the zero value (0) here since ok is false
    }
    // v and ok are NOT in scope here
}

func main() {
    m := map[string]int{"a": 1, "b": 2}
    lookup(m, "a")  // Output: found a = 1
    lookup(m, "z")  // Output: key "z" not found (v = 0)
}
```

### Shadowing in for Loop

```go
package main

import "fmt"

func main() {
    sum := 0

    for i := 0; i < 5; i++ {
        // i is in the for implicit block
        // 'sum' is from the outer function block — accessible and modifiable
        sum += i
    }
    // i is NOT in scope here

    fmt.Println(sum) // Output: 10

    // Range loop with shadowing
    nums := []int{10, 20, 30}
    for i, v := range nums {
        // i and v are in the for implicit block
        _ = i
        _ = v
    }
    // i and v are NOT in scope here
}
```

### Shadowing in switch

```go
package main

import "fmt"

func classify(n int) string {
    switch {
    case n < 0:
        result := "negative"   // result in case 1 block
        return result
    case n == 0:
        result := "zero"       // result in case 2 block — different variable
        return result
    default:
        result := "positive"   // result in default block — different variable again
        return result
    }
}

func main() {
    fmt.Println(classify(-5)) // Output: negative
    fmt.Println(classify(0))  // Output: zero
    fmt.Println(classify(3))  // Output: positive
}
```

### Complete Scope Hierarchy Example

```go
package main

import "fmt"

// Universe block: predeclared identifiers (len, make, int, string, true, false, nil, ...)
// Package block begins here

var packageVar = "I am package-scoped"

func scopeDemo() {
    // Function block
    functionVar := "I am function-scoped"
    fmt.Println(packageVar)  // accessible: package block ⊂ function scope
    fmt.Println(functionVar) // accessible: same block

    // Local block (if implicit block)
    if initVar := "if-init"; len(initVar) > 0 {
        // initVar, innerVar both in if-body block
        innerVar := "if-body"
        fmt.Println(initVar)     // accessible
        fmt.Println(innerVar)    // accessible
        fmt.Println(functionVar) // accessible: outer function block
    } else {
        // initVar accessible here too (same implicit if block)
        fmt.Println("else:", initVar)
        // innerVar is NOT accessible (declared in if-body block, not else)
    }
    // initVar is NOT accessible here

    // Shadowing demonstration
    shadow := "outer"
    fmt.Println(shadow) // outer
    {
        shadow := "inner"           // new variable, shadows outer
        fmt.Println(shadow)         // inner
        shadow = "inner-modified"   // modifies inner shadow
        fmt.Println(shadow)         // inner-modified
    }
    fmt.Println(shadow) // outer — unchanged
}

func main() {
    scopeDemo()
}
// Output:
// I am package-scoped
// I am function-scoped
// if-init
// if-body
// I am function-scoped
// outer
// inner
// inner-modified
// outer
```

### Go 1.22 Loop Variable Scope

```go
package main

import "fmt"

func main() {
    // Go 1.22+: each iteration gets its own i
    // Pre-1.22: all closures would capture the same i (value at end of loop)
    funcs := make([]func(), 5)
    for i := range 5 {
        funcs[i] = func() { fmt.Println(i) }
    }
    for _, f := range funcs {
        f()
    }
    // Go 1.22 Output: 0, 1, 2, 3, 4
    // Pre-1.22 Output: 5, 5, 5, 5, 5
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Blocks | https://go.dev/ref/spec#Blocks | Block grammar and implicit block list |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Full scoping rules (8 rules) |
| Variable declarations | https://go.dev/ref/spec#Variable_declarations | var scope begins at end of VarSpec |
| Short variable declarations | https://go.dev/ref/spec#Short_variable_declarations | `:=` redeclaration requires same block |
| Blank identifier | https://go.dev/ref/spec#Blank_identifier | `_` does not introduce a binding |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | Universe block identifiers |
| Label scopes | https://go.dev/ref/spec#Declarations_and_scope | Labels have different (function-wide) scope |
| If statements | https://go.dev/ref/spec#If_statements | Implicit block for if-init |
| For statements | https://go.dev/ref/spec#For_statements | Implicit block for for-init, loop variable scope |
| Switch statements | https://go.dev/ref/spec#Switch_statements | Implicit blocks per case clause |
| Package clause | https://go.dev/ref/spec#Package_clause | Package name not in any scope |
| Import declarations | https://go.dev/ref/spec#Import_declarations | Package name scoped to file block |
