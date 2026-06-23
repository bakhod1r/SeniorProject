# Boolean — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Boolean_types + §Comparison_operators + §Logical_operators

## Table of Contents
1. [Spec Reference](#1-spec-reference)
2. [Formal Grammar](#2-formal-grammar)
3. [Core Rules](#3-core-rules)
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

### Boolean Types (from Go Language Specification)

> A boolean type represents the set of Boolean truth values denoted by the predeclared constants `true` and `false`. The predeclared boolean type is `bool`; it is a defined type.

- Predeclared type: `bool`
- Predeclared constants: `true`, `false`
- `bool` is a **defined type** (not just an alias — it has an explicit type definition in the language)
- The zero value of `bool` is `false`

### Comparison Operators (from Go Language Specification)

> Comparison operators compare two operands and yield an **untyped boolean value**.
>
> ```
> ==    equal
> !=    not equal
> <     less
> <=    less or equal
> >     greater
> >=    greater or equal
> ```
>
> In any comparison, the first operand must be assignable to the type of the second operand, or vice versa.

> Boolean types are comparable. Two boolean values are equal if they are either both `true` or both `false`.

### Logical Operators (from Go Language Specification)

> Logical operators apply to boolean values and yield a result of the same type as the operands. The left operand is evaluated, and then the right if the condition requires it.
>
> ```
> &&    conditional AND    p && q  is  "if p then q else false"
> ||    conditional OR     p || q  is  "if p then true else q"
> !     NOT                !p      is  "not p"
> ```

---

## 2. Formal Grammar

From the Go specification, the EBNF grammar for boolean-related literals:

```ebnf
bool_type    = "bool" .

bool_lit     = "true" | "false" .

UnaryExpr    = PrimaryExpr | unary_op UnaryExpr .
unary_op     = "!" | ... .

BinaryExpr   = Expression binary_op Expression .
binary_op    = rel_op | "&&" | "||" .
rel_op       = "==" | "!=" | "<" | "<=" | ">" | ">=" .
```

The predeclared identifiers `true` and `false` are **untyped boolean constants**, not keywords. They are defined in the **universe block**.

From the spec on predeclared identifiers:

```
Constants:
    true false iota
```

---

## 3. Core Rules

### Rule 1: bool is a defined type
`bool` is a distinct defined type. It cannot be implicitly converted to or from any integer type (unlike C).

```go
var b bool = true
var i int = 1
// b = i  // COMPILE ERROR: cannot use i (type int) as type bool
```

### Rule 2: Comparison yields untyped boolean
The result of a comparison operator is an **untyped boolean constant** (when both operands are constants) or a value of type `bool` (when at least one operand is not a constant).

```go
const x = (1 < 2)   // x is an untyped boolean constant: true
var y bool = (1 < 2) // y is a typed bool: true
```

### Rule 3: Comparison operand assignability
> In any comparison, the first operand must be assignable to the type of the second operand, or vice versa.

This means both operands must be of compatible types.

### Rule 4: Short-circuit evaluation
The spec explicitly defines short-circuit evaluation for `&&` and `||`:
- `p && q`: if `p` is false, `q` is **not evaluated**
- `p || q`: if `p` is true, `q` is **not evaluated**

---

## 4. Type Rules

### Assignability
A value `x` of type `bool` can be assigned to a variable of type `bool` directly. An untyped boolean constant can be assigned to any boolean type.

### Comparability
From the spec:
> Boolean types are comparable. Two boolean values are equal if they are either both `true` or both false.

This means `bool` supports `==` and `!=` but **not** `<`, `<=`, `>`, `>=` — those ordering operators do not apply to booleans.

### Named Boolean Types
You can define a named type based on `bool`:

```go
type MyBool bool
var a MyBool = true
var b bool = true
// a == b  // COMPILE ERROR: mismatched types MyBool and bool
```

To compare, you must convert explicitly:

```go
bool(a) == b  // valid
```

### Zero Value
> Each element of such a variable or value is set to the **zero value** for its type: `false` for booleans.

---

## 5. Behavioral Specification

### Short-Circuit Evaluation — Specification-Defined

The Go specification mandates that `&&` and `||` use short-circuit (lazy) evaluation:

| Expression | p is true | p is false |
|------------|-----------|------------|
| `p && q`   | evaluate q | q not evaluated, result is false |
| `p \|\| q`   | q not evaluated, result is true | evaluate q |

This is a **language guarantee**, not an implementation detail. Side effects in `q` will not occur when short-circuited.

### Boolean in Conditional Contexts
From the spec on `if`, `for`, and `switch` statements, the condition expression must be of type `bool`:

```
IfStmt     = "if" [ SimpleStmt ";" ] Expression Block [ "else" ( IfStmt | Block ) ] .
```

The `Expression` in `if` must evaluate to type `bool`. Unlike C, any integer value is NOT implicitly truthy.

### The `!` Unary Operator
`!p` yields `true` if `p` is `false`, and `false` if `p` is `true`. The operand must be of type `bool`.

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec
| Behavior | Specification Guarantee |
|----------|------------------------|
| `true == true` | Always `true` |
| `false == false` | Always `true` |
| `true == false` | Always `false` |
| Short-circuit `&&` | Right operand not evaluated when left is `false` |
| Short-circuit `\|\|` | Right operand not evaluated when left is `true` |
| Zero value of `bool` | Always `false` |
| Integer-to-bool conversion | Not allowed (compile error) |
| `bool` ordering (`<`, `>`) | Not defined — compile error |

### Not Defined (Would Be a Compile Error)
- Converting `int` to `bool` without an explicit comparison
- Using `bool` in arithmetic expressions
- Applying `<`, `<=`, `>`, `>=` to boolean values

---

## 7. Edge Cases from Spec

### Edge Case 1: Untyped Boolean Constants
Untyped boolean constants can be used in expressions without explicit type:

```go
const a = true && false   // untyped bool constant: false
const b = !true           // untyped bool constant: false
const c = (1 == 1)        // untyped bool constant: true (derived from comparison)
```

### Edge Case 2: Interface Comparison
From the spec:
> Interface types that are not type parameters are comparable. Two interface values are equal if they have identical dynamic types and equal dynamic values or if both have value nil.

If an interface holds a non-comparable type (like a slice) and you compare it, it causes a **runtime panic**, not a compile error.

### Edge Case 3: Named Bool Type
```go
type Flag bool

const (
    Off Flag = false
    On  Flag = true
)

var f Flag = On
// if f == true { ... }   // COMPILE ERROR: mismatched types Flag and untyped bool
if f == On { }            // valid
if bool(f) == true { }    // valid (explicit conversion)
```

### Edge Case 4: Boolean in `select` / `switch`
In a `switch` statement without an expression, each case must evaluate to `bool`:

```go
switch {
case x > 0:   // evaluates to bool
    ...
case x < 0:   // evaluates to bool
    ...
}
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `bool` type introduced as a predeclared defined type |
| Go 1.0 | `true` and `false` predeclared constants |
| Go 1.0 | Short-circuit evaluation guaranteed for `&&` and `||` |
| Go 1.18 | Type parameters: `comparable` constraint includes `bool` |

No changes to the boolean type have been made since Go 1.0. The type and its operators are stable across all Go versions.

---

## 9. Implementation-Specific Behavior

### Memory Representation
The Go specification does **not** mandate the size of `bool`. In practice, all major Go implementations (gc, gccgo) use 1 byte (8 bits) for `bool`, but only 1 bit of information is stored.

### Alignment
Implementation-specific. The `unsafe.Sizeof(bool)` returns `1` in the standard gc compiler.

### CPU Instructions
Short-circuit evaluation is implemented using conditional branch instructions. The spec guarantees the semantic behavior; the actual machine instruction sequence is implementation-defined.

---

## 10. Spec Compliance Checklist

- [ ] `bool` is a predeclared defined type (not a keyword, not an alias)
- [ ] Only `true` and `false` are valid boolean literals
- [ ] Zero value of `bool` is `false`
- [ ] Comparison operators (`==`, `!=`) return a value of type `bool`
- [ ] Ordering operators (`<`, `<=`, `>`, `>=`) do NOT apply to `bool`
- [ ] `&&` and `||` short-circuit: right operand not evaluated when unnecessary
- [ ] No implicit conversion between `bool` and integer types
- [ ] Named types derived from `bool` are distinct types requiring explicit conversion
- [ ] Untyped boolean constants can be assigned to any `bool`-kinded type
- [ ] Conditions in `if`, `for`, and `switch` must be of type `bool`

---

## 11. Official Examples

### Example 1: Basic Boolean Declaration and Operations

```go
package main

import "fmt"

func main() {
    // Zero value of bool
    var b bool
    fmt.Println(b) // false

    // Predeclared constants
    t := true
    f := false
    fmt.Println(t, f) // true false

    // Comparison operators yield bool
    fmt.Println(1 == 1)  // true
    fmt.Println(1 != 2)  // true
    fmt.Println(3 < 5)   // true
    fmt.Println(5 > 10)  // false

    // Logical operators
    fmt.Println(true && false) // false
    fmt.Println(true || false) // true
    fmt.Println(!true)         // false
}
```

### Example 2: Short-Circuit Evaluation (Spec-Guaranteed)

```go
package main

import "fmt"

func sideEffect(name string, val bool) bool {
    fmt.Println("evaluated:", name)
    return val
}

func main() {
    // Short-circuit AND: right not evaluated when left is false
    result := sideEffect("left", false) && sideEffect("right", true)
    fmt.Println("result:", result)
    // Output:
    // evaluated: left
    // result: false
    // ("right" is never printed)

    fmt.Println("---")

    // Short-circuit OR: right not evaluated when left is true
    result = sideEffect("left", true) || sideEffect("right", false)
    fmt.Println("result:", result)
    // Output:
    // evaluated: left
    // result: true
    // ("right" is never printed)
}
```

### Example 3: Named Boolean Type

```go
package main

import "fmt"

type MyFlag bool

const (
    Disabled MyFlag = false
    Enabled  MyFlag = true
)

func main() {
    var flag MyFlag = Enabled

    // Must use same type or explicit conversion for comparison
    if flag == Enabled {
        fmt.Println("flag is enabled")
    }

    // Convert to bool for use with plain bool functions
    boolVal := bool(flag)
    fmt.Println("as bool:", boolVal) // true
}
```

### Example 4: Boolean in Conditional Expressions

```go
package main

import "fmt"

func isEven(n int) bool {
    return n%2 == 0
}

func main() {
    for i := 0; i < 5; i++ {
        if isEven(i) {
            fmt.Printf("%d is even\n", i)
        }
    }

    // Switch without expression (each case must be bool)
    x := 42
    switch {
    case x < 0:
        fmt.Println("negative")
    case x == 0:
        fmt.Println("zero")
    case x > 0:
        fmt.Println("positive")
    }
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Boolean types | https://go.dev/ref/spec#Boolean_types | Core definition |
| Comparison operators | https://go.dev/ref/spec#Comparison_operators | How bool values are produced |
| Logical operators | https://go.dev/ref/spec#Logical_operators | `&&`, `\|\|`, `!` with short-circuit semantics |
| Constants | https://go.dev/ref/spec#Constants | Untyped boolean constants `true`/`false` |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | `bool`, `true`, `false` in universe block |
| If statements | https://go.dev/ref/spec#If_statements | Requires bool expression in condition |
| For statements | https://go.dev/ref/spec#For_statements | Requires bool expression in condition |
| Type definitions | https://go.dev/ref/spec#Type_declarations | How `type MyBool bool` creates distinct type |
| Assignability | https://go.dev/ref/spec#Assignability | Rules for assigning bool values |
| Conversions | https://go.dev/ref/spec#Conversions | No direct numeric-to-bool conversion |
