# const and iota — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Constant_declarations + §Iota

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

### Constant Declarations — Official Text (verbatim)

> A constant declaration binds a list of identifiers (the names of the
> constants) to the values of a list of constant expressions. The number of
> identifiers must be equal to the number of expressions, and the nth identifier
> on the left is bound to the value of the nth expression on the right.

Source: https://go.dev/ref/spec#Constant_declarations

### Type Handling — Official Text (verbatim)

> If the type is present, all constants take the type specified, and the
> expressions must be assignable to that type, which must not be a type
> parameter. If the type is omitted, the constants take the individual types of
> the corresponding expressions. If the expression values are untyped constants,
> the declared constants remain untyped and the constant identifiers denote the
> constant values. For instance, if the expression is a floating-point literal,
> the constant identifier denotes a floating-point constant, even if the
> literal's fractional part is zero.

Source: https://go.dev/ref/spec#Constant_declarations

### Expression List Repetition — Official Text (verbatim)

> Within a parenthesized `const` declaration list the expression list may be
> omitted from any but the first ConstSpec. Such an empty list is equivalent to
> the textual substitution of the first preceding non-empty expression list and
> its type if any. Omitting the list of expressions is therefore equivalent to
> repeating the previous list. The number of identifiers must be equal to the
> number of expressions in the previous list.

Source: https://go.dev/ref/spec#Constant_declarations

### Iota — Official Text (verbatim)

> Within a constant declaration, the predeclared identifier `iota` represents
> successive untyped integer constants. Its value is the index of the respective
> ConstSpec in that constant declaration, starting at zero. It can be used to
> construct a set of related constants.

Source: https://go.dev/ref/spec#Iota

### Iota Same ConstSpec — Official Text (verbatim)

> By definition, multiple uses of `iota` in the same ConstSpec all have the
> same value.

Source: https://go.dev/ref/spec#Iota

---

## 2. Formal Grammar (EBNF)

### Constant Declaration Grammar

```ebnf
ConstDecl      = "const" ( ConstSpec | "(" { ConstSpec ";" } ")" ) .
ConstSpec      = IdentifierList [ [ Type ] "=" ExpressionList ] .

IdentifierList = identifier { "," identifier } .
ExpressionList = Expression { "," Expression } .
```

### Key Grammar Notes

1. A single `const` can declare one spec: `const Pi = 3.14159`
2. A grouped `const (...)` can declare multiple ConstSpecs separated by `;`
   (semicolons are inserted automatically by the lexer at line breaks)
3. In a grouped `const`, a ConstSpec may omit `"=" ExpressionList` — but
   **only from the second ConstSpec onward**. The first must have a value.
4. The optional `Type` in `ConstSpec` applies to **all** identifiers in that
   ConstSpec.

### iota Grammar Context

`iota` appears as a predeclared identifier within ConstSpec expressions:

```ebnf
// iota is a PrimaryExpr that evaluates to the ConstSpec index
PrimaryExpr = iota | ...
```

`iota` is **only meaningful inside a const declaration**. Outside a const
declaration, `iota` is an undefined identifier.

---

## 3. Core Rules & Constraints

### Rule 1 — Constants Are Immutable

Once declared, a constant's value cannot be changed. There is no assignment
to a constant after declaration.

### Rule 2 — Constant Expressions Only

Constants must be initialized with **constant expressions**. The spec defines
constant expressions as expressions that can be evaluated at compile time.
Variables, function calls (other than certain built-ins like `len` of a string
constant), and runtime values cannot appear in a const initializer.

```go
const x = 42           // legal: integer literal is a constant expression
const y = x + 1        // legal: x is a constant, x+1 is a constant expression
const z = len("hello") // legal: len of string constant is a constant expression
// const w = os.Getpid() // ILLEGAL: function call, runtime value
```

### Rule 3 — iota Resets to 0 Per const Block

`iota` resets to `0` at the beginning of each **new** `const (...)` block (or
`const` single declaration). Within a block it increments by 1 for each
ConstSpec line.

```go
const x = iota  // x == 0  (standalone const — iota resets)
const y = iota  // y == 0  (another standalone const — iota resets again)
```

### Rule 4 — iota Increments Per ConstSpec, Not Per Identifier

In a grouped block, `iota` increments once per ConstSpec (once per line in
practice), not once per identifier. Multiple identifiers on the same ConstSpec
all share the same `iota` value.

```go
const (
    A, B = iota, iota  // A == 0, B == 0  (same ConstSpec: iota == 0)
    C, D = iota, iota  // C == 1, D == 1  (next ConstSpec: iota == 1)
)
```

### Rule 5 — Blank Identifier Counts as a ConstSpec Line

Using `_, _` to skip an iota value still advances the counter because it is a
full ConstSpec:

```go
const (
    bit0, mask0 = 1 << iota, 1<<iota - 1  // iota == 0
    bit1, mask1                           // iota == 1
    _, _                                  // iota == 2 (skipped)
    bit3, mask3                           // iota == 3
)
```

### Rule 6 — Type Must Not Be a Type Parameter

In a typed constant declaration, the explicit type `"must not be a type
parameter"` (spec). Constants in generic functions cannot use type parameters
as their declared type.

### Rule 7 — Identifier Count Must Match Expression Count

The number of identifiers on the left of `=` must equal the number of
expressions on the right. For implicit repetition (omitted expression list),
the new identifier count must match the previous ConstSpec's identifier count.

---

## 4. Type Rules

### Typed Constants

A typed constant has a specific named type. Its value must be assignable to
that type:

```go
const Pi float64 = 3.14159265358979323846  // typed: float64
const size int64 = 1024                    // typed: int64
const MaxUint8 uint8 = 255                 // typed: uint8
```

A typed constant can only be used in contexts where its type is compatible.

### Untyped Constants

When no type is specified, and the expression value is an untyped constant, the
constant itself remains **untyped**. Untyped constants have a **kind** (integer,
float, complex, rune, string, boolean) but no fixed type. They gain a type only
when used in a context that requires a typed value.

```go
const zero = 0.0      // untyped floating-point constant
const eof  = -1       // untyped integer constant
const msg  = "hello"  // untyped string constant
```

### Default Types for Untyped Constants

When an untyped constant must be converted to a typed value (e.g., assigned to
a variable or passed to a function), it converts to its **default type**:

| Constant Kind | Default Type |
|---------------|-------------|
| Untyped integer | `int` |
| Untyped floating-point | `float64` |
| Untyped complex | `complex128` |
| Untyped rune | `rune` (= `int32`) |
| Untyped string | `string` |
| Untyped boolean | `bool` |

### iota Type

`iota` is an untyped integer constant. Its type follows the same rules as other
untyped integer constants. In `const (v float64 = iota * 42)`, the `float64`
type forces the result to be a typed `float64` constant.

---

## 5. Behavioral Specification

### iota Value Mechanics

The spec states: "Its value is the index of the respective ConstSpec in that
constant declaration, starting at zero."

This means:

| ConstSpec index | iota value |
|----------------|-----------|
| 0 (first line) | 0 |
| 1 (second line) | 1 |
| 2 (third line) | 2 |
| n | n |

### Expression Repetition with iota

When an expression list is omitted from a ConstSpec, the previous expression
list is textually substituted — including any occurrences of `iota`. Since
`iota` has a new value on each line, this produces a new result:

```go
const (
    Sunday = iota  // iota==0, Sunday==0
    Monday         // iota==1, Monday==1  (expression "iota" repeated)
    Tuesday        // iota==2, Tuesday==2
)
```

### Typed vs Untyped in Expressions

Typed constants require expression values to be assignable to the declared type.
Untyped constants have arbitrary precision during evaluation and are only
constrained when used.

```go
const Big = 1 << 100   // untyped integer — valid, arbitrary precision
// var x int = Big     // compile error: Big overflows int
var y float64 = Big    // valid: Big is assignable to float64 (as 1.2676...e30)
```

---

## 6. Defined vs Undefined Behavior

### Defined — Legal Constant Operations

| Operation | Result |
|-----------|--------|
| `const x = 42` | x is untyped integer constant 42 |
| `const x int = 42` | x is typed int constant 42 |
| `const x = iota` in grouped block | x is the ConstSpec index |
| `const x = iota` standalone | x == 0 always |
| Omitting expression in const block (not first) | Repeats previous expression |
| `const _, _ = iota, iota` | Skips two values with same iota |

### Undefined / Illegal Operations

| Operation | Result |
|-----------|--------|
| Assigning to a constant | **Compile error** — constants are immutable |
| `const x = os.Getpid()` | **Compile error** — not a constant expression |
| `const x = y` where y is a variable | **Compile error** — not a constant expression |
| Typed constant with incompatible initializer | **Compile error** |
| Omitting expression list on the first ConstSpec in a block | **Compile error** |
| Using `iota` outside a const declaration | **Compile error** — undefined identifier |
| `const x uint8 = 256` | **Compile error** — constant 256 overflows uint8 |

---

## 7. Edge Cases from Spec

### Edge Case 1 — iota in Expressions

`iota` can appear as part of a larger constant expression. The expression is
re-evaluated with the current `iota` value on each ConstSpec:

```go
const (
    a = 1 << iota  // a == 1   (1 << 0)
    b = 1 << iota  // b == 2   (1 << 1)
    c = 3          // c == 3   (iota == 2, but not used)
    d = 1 << iota  // d == 8   (1 << 3)
)
```

### Edge Case 2 — Typed iota

When a type is specified for one ConstSpec in a group, that type applies only
to that ConstSpec (not to repeated lines without a type):

```go
const (
    u         = iota * 42  // u == 0     (untyped integer constant)
    v float64 = iota * 42  // v == 42.0  (float64 constant)
    w         = iota * 42  // w == 84    (untyped integer constant — NOT float64)
)
```

### Edge Case 3 — Skipping Values with Blank Identifier

```go
const (
    bit0, mask0 = 1 << iota, 1<<iota - 1  // bit0==1, mask0==0  (iota==0)
    bit1, mask1                           // bit1==2, mask1==1  (iota==1)
    _, _                                  //                    (iota==2, skipped)
    bit3, mask3                           // bit3==8, mask3==7  (iota==3)
)
```

The spec's own example demonstrating blank identifier to skip an iota value.

### Edge Case 4 — Multiple iota in Same ConstSpec

Multiple uses of `iota` in the same ConstSpec all have the same value:

```go
const (
    bit0, mask0 = 1 << iota, 1<<iota - 1
    // Both uses of iota in this line are 0
    // bit0 = 1<<0 = 1
    // mask0 = 1<<0 - 1 = 0
)
```

### Edge Case 5 — Float Constant From Integer-Looking Expression

The spec notes: "if the expression is a floating-point literal, the constant
identifier denotes a floating-point constant, even if the literal's fractional
part is zero."

```go
const zero = 0.0  // untyped FLOATING-POINT constant, NOT integer
// var x int = zero // would be legal (0.0 can represent integer 0)
// but zero's kind is float, not integer
```

### Edge Case 6 — Very Large Untyped Constants

Untyped constants have arbitrary precision. A constant like `1 << 100` is
perfectly valid as an untyped constant:

```go
const Big   = 1 << 62   // valid untyped integer
const Huge  = 1 << 100  // valid untyped integer (cannot fit in any Go integer type)
// var x int = Huge     // compile error: Huge overflows int
var y float64 = Huge    // valid: float64 can approximate it
```

### Edge Case 7 — Constant Iota Only Valid Inside const Block

```go
func f() {
    // fmt.Println(iota) // compile error: undefined: iota
}

const x = iota  // valid: x == 0
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | `const` and `iota` introduced as core language features |
| Go 1.0 | `iota` reset-per-block and increment-per-ConstSpec semantics established |
| Go 1.4 | No change to const/iota semantics |
| Go 1.9 | `math/bits` package added; many bit-width constants defined with iota |
| Go 1.17 | `unsafe.Add` and `unsafe.Slice` added; no change to const semantics |
| Go 1.18 | Generics: type parameters explicitly forbidden as the type of a typed constant |
| Go 1.21 | `min`, `max` built-ins added; no change to const/iota |

---

## 9. Implementation-Specific Behavior

### Constant Precision

The Go spec requires that untyped constants have **at least 256 bits of
mantissa precision** for integer and floating-point constants. The `gc`
compiler implements this. This means very large integer and very precise
floating-point constants can be represented exactly as untyped constants.

### Compile-Time Evaluation

All constant expressions are evaluated at **compile time**. No runtime cost.
This includes complex arithmetic, shifts, and string concatenation.

### Overflow Detection

Overflow in typed constant expressions is detected at **compile time**:

```go
const x uint8 = 256  // compile error: constant 256 overflows uint8
```

For untyped constants, overflow is only checked when the value is used in a
context requiring a specific type.

### Implementation-Specific: iota and go:generate

`iota` is frequently used with `go:generate` and `stringer` to automatically
generate string representations for constant groups. This is a convention in
the Go ecosystem, not a spec requirement.

---

## 10. Spec Compliance Checklist

- [ ] Constants are initialized with constant expressions only
- [ ] Typed constants have initializer values assignable to their declared type
- [ ] `iota` is used only inside `const` declarations
- [ ] `iota` starts at 0 in each `const` block/declaration
- [ ] `iota` increments once per ConstSpec (line), not per identifier
- [ ] Multiple `iota` uses in the same ConstSpec all produce the same value
- [ ] Blank identifier `_` in a ConstSpec still increments `iota`
- [ ] Expression list omission (implicit repetition) only from the second ConstSpec onward
- [ ] Identifier count matches expression count (or previous count for implicit repetition)
- [ ] Type parameters are not used as the type of a typed constant
- [ ] Constants are not reassigned after declaration

---

## 11. Official Examples

All examples below include the official spec examples verbatim, plus annotated
runnable code.

### Official Spec Examples — Constant Declarations

```go
package main

import "fmt"

func main() {
    // From the Go spec — §Constant_declarations

    const Pi float64 = 3.14159265358979323846
    const zero = 0.0 // untyped floating-point constant
    const (
        size int64 = 1024
        eof        = -1 // untyped integer constant
    )
    const a, b, c = 3, 4, "foo" // a=3, b=4, c="foo", untyped int and string
    const u, v float32 = 0, 3    // u=0.0, v=3.0

    fmt.Println(Pi)        // 3.141592653589793
    fmt.Println(zero)      // 0
    fmt.Println(size, eof) // 1024 -1
    fmt.Println(a, b, c)   // 3 4 foo
    fmt.Println(u, v)      // 0 3

    // Days of the week using iota (from spec)
    const (
        Sunday = iota
        Monday
        Tuesday
        Wednesday
        Thursday
        Friday
        Partyday
        numberOfDays
    )
    fmt.Println(Sunday, Monday, Tuesday, Wednesday)
    // Output: 0 1 2 3
    fmt.Println(Thursday, Friday, Partyday, numberOfDays)
    // Output: 4 5 6 7
}
```

### Official Spec Examples — Iota

```go
package main

import "fmt"

func main() {
    // From the Go spec — §Iota

    // Example 1: basic iota
    const (
        c0 = iota // c0 == 0
        c1 = iota // c1 == 1
        c2 = iota // c2 == 2
    )
    fmt.Println(c0, c1, c2) // Output: 0 1 2

    // Example 2: iota in expressions, with gap (c==3 not using iota)
    const (
        a = 1 << iota // a == 1  (iota == 0)
        b = 1 << iota // b == 2  (iota == 1)
        c = 3         // c == 3  (iota == 2, unused)
        d = 1 << iota // d == 8  (iota == 3)
    )
    fmt.Println(a, b, c, d) // Output: 1 2 3 8

    // Example 3: typed iota
    const (
        u         = iota * 42  // u == 0     (untyped integer constant)
        v float64 = iota * 42  // v == 42.0  (float64 constant)
        w         = iota * 42  // w == 84    (untyped integer constant)
    )
    fmt.Println(u, v, w) // Output: 0 42 84

    // Example 4: standalone const iota always == 0
    const x = iota // x == 0
    const y = iota // y == 0
    fmt.Println(x, y) // Output: 0 0

    // Example 5: multiple iota in same ConstSpec (from spec)
    const (
        bit0, mask0 = 1 << iota, 1<<iota - 1 // bit0==1, mask0==0  (iota==0)
        bit1, mask1                           // bit1==2, mask1==1  (iota==1)
        _, _                                  //                    (iota==2)
        bit3, mask3                           // bit3==8, mask3==7  (iota==3)
    )
    fmt.Println(bit0, mask0) // Output: 1 0
    fmt.Println(bit1, mask1) // Output: 2 1
    fmt.Println(bit3, mask3) // Output: 8 7
}
```

### Typed vs Untyped Constants in Practice

```go
package main

import "fmt"

type Direction int

const (
    North Direction = iota // typed: Direction
    East
    South
    West
)

type ByteSize float64

const (
    _           = iota // ignore first value by assigning to blank identifier
    KB ByteSize = 1 << (10 * iota) // 1 << 10 = 1024
    MB                             // 1 << 20
    GB                             // 1 << 30
    TB                             // 1 << 40
)

func main() {
    fmt.Println(North, East, South, West) // Output: 0 1 2 3

    var d Direction = North
    fmt.Println(d) // Output: 0

    fmt.Printf("KB = %.0f\n", float64(KB)) // Output: KB = 1024
    fmt.Printf("MB = %.0f\n", float64(MB)) // Output: MB = 1048576
    fmt.Printf("GB = %.0f\n", float64(GB)) // Output: GB = 1073741824

    // Untyped constant — flexible type usage
    const maxItems = 100 // untyped int constant
    var count int = maxItems        // OK: int
    var count32 int32 = maxItems    // OK: int32
    var count64 int64 = maxItems    // OK: int64
    fmt.Println(count, count32, count64) // Output: 100 100 100
}
```

### Complex iota Patterns

```go
package main

import "fmt"

func main() {
    // Bit flags using iota
    const (
        Read    = 1 << iota // 1 (001)
        Write               // 2 (010)
        Execute             // 4 (100)
    )
    fmt.Printf("Read=%d Write=%d Execute=%d\n", Read, Write, Execute)
    // Output: Read=1 Write=2 Execute=4

    // Combined flags
    perm := Read | Write
    fmt.Printf("Read|Write = %d\n", perm) // Output: Read|Write = 3

    // Weekday with iota starting at 1
    type Weekday int
    const (
        Monday    Weekday = iota + 1 // 1
        Tuesday                      // 2
        Wednesday                    // 3
        Thursday                     // 4
        Friday                       // 5
        Saturday                     // 6
        Sunday                       // 7
    )
    fmt.Println(Monday, Friday, Sunday) // Output: 1 5 7

    // Error codes
    const (
        ErrNone    = iota // 0
        ErrNotFound       // 1
        ErrTimeout        // 2
        ErrInternal       // 3
    )
    fmt.Println(ErrNone, ErrNotFound, ErrTimeout, ErrInternal)
    // Output: 0 1 2 3
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Constants | https://go.dev/ref/spec#Constants | What constitutes a constant value in Go |
| Constant expressions | https://go.dev/ref/spec#Constant_expressions | What expressions are valid in const declarations |
| Iota | https://go.dev/ref/spec#Iota | iota mechanics |
| Constant declarations | https://go.dev/ref/spec#Constant_declarations | Full const declaration grammar and rules |
| Variable declarations | https://go.dev/ref/spec#Variable_declarations | Contrast with variable declarations |
| Declarations and scope | https://go.dev/ref/spec#Declarations_and_scope | Scope of declared constants |
| Assignability | https://go.dev/ref/spec#Assignability | When untyped constants can be assigned |
| Numeric types | https://go.dev/ref/spec#Numeric_types | Overflow rules for typed numeric constants |
| Predeclared identifiers | https://go.dev/ref/spec#Predeclared_identifiers | iota listed as a predeclared constant |
| Type definitions | https://go.dev/ref/spec#Type_definitions | Defining new types based on const-typed values (enums) |
