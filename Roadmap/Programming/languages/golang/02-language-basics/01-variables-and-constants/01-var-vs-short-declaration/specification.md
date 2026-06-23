# var vs Short Declaration (:=) — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Variable_declarations + §Short_variable_declarations

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

### Variable Declarations — Official Text

> A variable declaration creates one or more variables, binds corresponding
> identifiers to them, and gives each a type and an initial value.

Source: https://go.dev/ref/spec#Variable_declarations

### Short Variable Declarations — Official Text

> A short variable declaration uses the syntax `IdentifierList ":=" ExpressionList`.
> It is shorthand for a regular variable declaration with initializer expressions
> but no types.

Source: https://go.dev/ref/spec#Short_variable_declarations

### Redeclaration Rule — Official Text

> Unlike regular variable declarations, a short variable declaration may
> **redeclare** variables provided they were originally declared earlier in the
> same block (or the parameter lists if the block is the function body) with the
> same type, and at least one of the non-blank variables is new. As a
> consequence, redeclaration can only appear in a multi-variable short
> declaration. Redeclaration does not introduce a new variable; it just assigns
> a new value to the original. The non-blank variable names on the left side
> of `:=` must be unique.

Source: https://go.dev/ref/spec#Short_variable_declarations

### Scope Restriction — Official Text

> Short variable declarations may appear only inside functions. In some contexts
> such as the initializers for "if", "for", or "switch" statements, they can be
> used to declare local temporary variables.

Source: https://go.dev/ref/spec#Short_variable_declarations

---

## 2. Formal Grammar (EBNF)

### Variable Declaration Grammar

```ebnf
VarDecl  = "var" ( VarSpec | "(" { VarSpec ";" } ")" ) .
VarSpec  = IdentifierList ( Type [ "=" ExpressionList ] | "=" ExpressionList ) .
```

### Short Variable Declaration Grammar

```ebnf
ShortVarDecl = IdentifierList ":=" ExpressionList .
```

### Supporting Productions

```ebnf
IdentifierList = identifier { "," identifier } .
ExpressionList = Expression { "," Expression } .
```

### Expansion Equivalence

The spec states that short variable declaration is shorthand for:

```ebnf
"var" IdentifierList "=" ExpressionList
```

Meaning `:=` always infers types — explicit type annotation is not possible with
the short declaration syntax.

---

## 3. Core Rules & Constraints

### Rule 1 — `var` Declaration Forms

A `var` declaration accepts four syntactic forms according to the EBNF:

| Form | Example | Notes |
|------|---------|-------|
| Type only | `var x int` | Initialised to zero value |
| Type + value | `var x int = 10` | Explicit type and explicit value |
| Value only | `var x = 10` | Type inferred from value |
| Multi-var grouped | `var ( ... )` | Each VarSpec on its own line |

### Rule 2 — Short Declaration Scope

`:=` is **only valid inside a function body**. The spec explicitly forbids its
use at package level. Any attempt to use `:=` outside a function is a compile
error.

### Rule 3 — Redeclaration Requirements

For `:=` to redeclare an existing variable, **all** of the following must hold:

1. The variable was declared in the **same block** (or function parameter list).
2. The redeclared variable has the **same type** as the original declaration.
3. **At least one** variable on the left side of `:=` must be **new** (not
   previously declared in the same block).

### Rule 4 — Blank Identifier

The blank identifier `_` may appear on the left side of both `var` and `:=`.
It does not introduce a binding. It is used to discard unwanted return values.

### Rule 5 — Uniqueness on Left Side of `:=`

The spec states: "The non-blank variable names on the left side of `:=` must be
unique." Repeating the same non-blank identifier on the left side is illegal.

```go
x, y, x := 1, 2, 3  // illegal: x repeated on left side of :=
```

### Rule 6 — Untyped Nil Cannot Initialise a `var` Without Explicit Type

The predeclared identifier `nil` cannot be used to initialize a variable with
no explicit type.

```go
var n = nil  // illegal: use of untyped nil
```

---

## 4. Type Rules

### Explicit Type (var)

When a type is present in a `var` declaration, **each variable is given that
type**. The initializer expression must be assignable to that type.

```go
var x int = 42       // x has type int
var f float32 = 3.14 // f has type float32
```

### Inferred Type (var without type)

When no type is given but an initializer is provided, each variable takes the
type of the corresponding initialization value. The spec states:

> If that value is an untyped constant, it is first implicitly converted to its
> **default type**; if it is an untyped boolean value, it is first implicitly
> converted to type `bool`.

Default types for untyped constants:

| Constant Kind | Default Type |
|---------------|-------------|
| Untyped integer | `int` |
| Untyped floating-point | `float64` |
| Untyped complex | `complex128` |
| Untyped rune | `rune` (`int32`) |
| Untyped string | `string` |
| Untyped boolean | `bool` |

```go
var d = math.Sin(0.5)  // d is float64
var i = 42             // i is int  (untyped 42 → default type int)
var t, ok = x.(T)      // t is T, ok is bool
```

### Short Declaration Type Inference

`:=` always infers types — it is equivalent to `var` with no type annotation:

```go
i := 42        // same as: var i = 42    → type int
f := 3.14      // same as: var f = 3.14  → type float64
s := "hello"   // same as: var s = "hello" → type string
```

### Multi-Value Assignment

Both forms support multi-value assignment from functions returning multiple
values:

```go
var re, im = complexSqrt(-1)  // types inferred from return values
r, w, _ := os.Pipe()          // third return value discarded
```

---

## 5. Behavioral Specification

### Initialization Order

Variables declared with `var` (without explicit initializer) are set to the
zero value for their type **before** any other initialization code runs.

### Assignment vs. New Variable (Redeclaration)

When `:=` redeclares an existing variable, **no new variable is created**.
The existing variable simply receives a new value. The spec is explicit:

> "Redeclaration does not introduce a new variable; it just assigns a new value
> to the original."

```go
field1, offset := nextField(str, 0)
field2, offset := nextField(str, offset)  // offset is reassigned, not redeclared as new
```

### Grouped var Declarations

Grouped `var` blocks (using parentheses) are evaluated in order. Each `VarSpec`
is independent — they do not share type or initializer from adjacent specs.

---

## 6. Defined vs Undefined Behavior

### Defined — Legal Operations

| Operation | Defined Behavior |
|-----------|-----------------|
| `var x int` | x is 0 (zero value) |
| `var x = 42` | x is int(42) |
| `x := 42` inside function | x is int(42), new variable |
| `x, y := 1, 2` | x=1, y=2, both new |
| `x, y := 3, 4` where x already exists | x reassigned to 3, y is new |
| `var _ = expr` | expression evaluated, value discarded |

### Undefined / Illegal Operations

| Operation | Result |
|-----------|--------|
| `x := 42` at package level | **Compile error** — `:=` only in functions |
| `var n = nil` | **Compile error** — untyped nil, no explicit type |
| `x, y, x := 1, 2, 3` | **Compile error** — x repeated on left side |
| `x := 42` where x is the only var and already exists in same block | **Compile error** — no new variable |
| `var x int = "hello"` | **Compile error** — string not assignable to int |

---

## 7. Edge Cases from Spec

### Edge Case 1 — `:=` Redeclaration Requires Same Block

A variable declared in an **outer** block cannot be "redeclared" with `:=`
in an inner block — that creates a **new** shadowing variable instead:

```go
package main

import "fmt"

func main() {
    x := 10          // x declared in function block
    {
        x := 20      // NEW x in inner block — shadows outer x, does not redeclare it
        fmt.Println(x) // Output: 20
    }
    fmt.Println(x)   // Output: 10 — outer x unchanged
}
```

### Edge Case 2 — `:=` in if/for/switch Initializer

The spec notes that `:=` can appear in the initializer clauses of `if`, `for`,
and `switch`. Variables declared there are scoped to the entire statement:

```go
if v, ok := someMap[key]; ok {
    fmt.Println(v) // v and ok are in scope here
} else {
    fmt.Println("not found") // v and ok are ALSO in scope here (same implicit block)
}
// v and ok are NOT in scope here
```

### Edge Case 3 — Blank Identifier Does Not Count as "New"

The blank identifier `_` on the left side of `:=` is not counted as a new
variable. At least one **non-blank** identifier must be new:

```go
_, err := doSomething()       // valid: _ is blank, err is new
_, err := doSomethingElse()   // valid: _ is blank, err is redeclared (existed above)
```

But this would be illegal:

```go
x := 10
x := 20  // illegal: x is the only var and is not new
```

### Edge Case 4 — Type Assertion with `:=`

A type assertion returning two values uses `:=` naturally:

```go
var t, ok = x.(T)  // t is T, ok is bool  (var form)
t, ok := x.(T)     // equivalent short form
```

### Edge Case 5 — Map Lookup with Blank Identifier

```go
var _, found = entries[name]  // only interested in the boolean "found"
_, found := entries[name]     // short form equivalent
```

### Edge Case 6 — All Variables Already Declared (Illegal)

```go
a, b := 1, 2
a, b := 3, 4  // illegal: no new variables on left side of :=
```

Fix: use plain assignment `=` instead of `:=`.

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `var` declaration and `:=` short declaration introduced as core language features |
| Go 1.18 | No change to declaration semantics; generics added type parameter declarations |
| Go 1.21 | `min`, `max`, `clear` added to predeclared identifiers; no change to var/`:=` rules |
| Go 1.22 | Loop variable semantics changed: each iteration of a `for` loop now creates a new variable for the loop variable (previously all iterations shared one variable) |

---

## 9. Implementation-Specific Behavior

### Compiler Restriction on Unused Variables

The spec states:

> **Implementation restriction:** A compiler may make it illegal to declare a
> variable inside a function body if the variable is never used.

The reference Go compiler (`gc`) enforces this restriction as a **hard error**,
not a warning. Any variable declared inside a function that is never read will
cause a compile error: `variable declared and not used`.

This restriction does **not** apply to:
- Package-level variables
- Variables assigned to `_`
- Function parameters and return values

### Platform-Dependent Type Sizes

Types `int`, `uint`, and `uintptr` have implementation-specific sizes (32 or 64
bits depending on the platform). Type inference with `:=` will produce `int`
for untyped integer constants regardless of platform, but the actual size varies.

---

## 10. Spec Compliance Checklist

Use this checklist to verify that code using variable declarations conforms to
the Go specification:

- [ ] `:=` is only used inside function bodies (never at package level)
- [ ] At least one non-blank identifier is new on the left side of every `:=`
- [ ] No identifier is repeated on the left side of `:=` (non-blank)
- [ ] Redeclared variables via `:=` have the same type as their original declaration
- [ ] `nil` is only used to initialize variables that have an explicit pointer, function, interface, slice, map, or channel type
- [ ] All variables declared inside functions are used at least once
- [ ] Multi-value assignments have the same count of identifiers and expressions
- [ ] Explicit types in `var` are assignable from the given initializer expression
- [ ] Untyped constants are understood to resolve to their default type when inferred

---

## 11. Official Examples

The following examples are taken directly from the Go Language Specification.

### var Declaration Examples (from spec)

```go
package main

import (
    "fmt"
    "math"
    "os"
)

func complexSqrt(x float64) (float64, float64) {
    return x, x * 2
}

func coord(p [2]float64) (float64, float64, float64) {
    return p[0], p[1], 0
}

func main() {
    // --- From spec: VarDecl examples ---

    var i int                         // i == 0 (zero value)
    var U, V, W float64               // U, V, W == 0.0
    var k = 0                         // k == 0, type int
    var x, y float32 = -1, -2        // x == -1.0, y == -2.0

    var (
        ii      int
        u, v, s = 2.0, 3.0, "bar" // u float64=2.0, v float64=3.0, s string="bar"
    )

    var re, im = complexSqrt(-1) // re, im are float64
    var _, found = map[string]int{"a": 1}["a"] // only interested in "found"

    fmt.Println(i, U, V, W, k, x, y)
    fmt.Println(ii, u, v, s)
    fmt.Println(re, im, found)

    // --- From spec: type inference examples ---

    var d = math.Sin(0.5) // d is float64
    var j = 42            // j is int
    var t, ok = interface{}(42).(int) // t is int, ok is bool

    fmt.Println(d, j, t, ok)

    // --- From spec: Short variable declaration examples ---

    a, b := 0, 10
    f := func() int { return 7 }
    ch := make(chan int)
    r, w, _ := os.Pipe() // third return (error) discarded
    _, yy, _ := coord([2]float64{3, 4})

    fmt.Println(a, b, f(), ch, r, w, yy)
    _ = ch

    // --- From spec: Redeclaration example ---

    str := "hello,world"
    nextField := func(s string, offset int) (string, int) {
        end := offset + 3
        if end > len(s) {
            end = len(s)
        }
        return s[offset:end], end
    }

    field1, offset := nextField(str, 0)
    field2, offset := nextField(str, offset) // redeclares offset
    fmt.Println(field1, field2, offset)
    // Output:
    // 0 0 0 0 0 -1 -2
    // 0 2 3 bar
    // -1 -2 true
    // 0.47942553860420295 42 42 true
    // 0 10 7 0xc000... 0xc000... 0xc000... 4
    // hel llo 6
}
```

### All Valid var Declaration Forms

```go
package main

import "fmt"

func main() {
    // Form 1: Type only → zero value
    var a int
    var b string
    var c bool
    fmt.Println(a, b, c) // Output: 0  false

    // Form 2: Type + value
    var d int = 100
    var e string = "Go"
    var f bool = true
    fmt.Println(d, e, f) // Output: 100 Go true

    // Form 3: Value only → type inferred
    var g = 3.14       // float64
    var h = "language" // string
    var i = []int{1, 2} // []int
    fmt.Println(g, h, i) // Output: 3.14 language [1 2]

    // Form 4: Grouped var block
    var (
        j int     = 10
        k float64 = 2.5
        l         = "grouped"
    )
    fmt.Println(j, k, l) // Output: 10 2.5 grouped

    // Form 5: Multi-identifier same type
    var m, n, o int
    fmt.Println(m, n, o) // Output: 0 0 0

    // Form 6: Multi-identifier same type + value
    var p, q float32 = -1, -2
    fmt.Println(p, q) // Output: -1 -2

    // Short declaration forms
    x := 42
    y := "short"
    z := true
    fmt.Println(x, y, z) // Output: 42 short true

    // Multi-value short declaration
    aa, bb := 1, 2
    fmt.Println(aa, bb) // Output: 1 2

    // Short declaration with blank identifier
    cc, _ := 10, 99
    fmt.Println(cc) // Output: 10
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Variables | https://go.dev/ref/spec#Variables | What variables are in Go |
| The zero value | https://go.dev/ref/spec#The_zero_value | Default initial values |
| Assignment statements | https://go.dev/ref/spec#Assignment_statements | How values are assigned |
| Blank identifier | https://go.dev/ref/spec#Blank_identifier | Role of `_` in declarations |
| Constants | https://go.dev/ref/spec#Constants | Untyped constants and default types |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Scope rules for declared identifiers |
| Blocks | https://go.dev/ref/spec#Blocks | Block nesting and scope boundaries |
| If statements | https://go.dev/ref/spec#If_statements | `:=` in if-init clause |
| For statements | https://go.dev/ref/spec#For_statements | `:=` in for-init clause |
| Conversions | https://go.dev/ref/spec#Conversions | Implicit conversion of untyped constants |
| Uniqueness of identifiers | https://go.dev/ref/spec#Uniqueness_of_identifiers | What makes identifiers unique |
