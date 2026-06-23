# Type Conversion — Specification

> **Official Specification Reference**
> Source: [Go Language Specification](https://go.dev/ref/spec) — §Conversions

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

### Conversions (from Go Language Specification)

> A conversion changes the type of an expression to the type specified by the conversion. A conversion may appear literally in the source, or it may be **implied by the context** in which an expression appears.
>
> An explicit conversion is an expression of the form `T(x)` where `T` is a type and `x` is an expression that can be converted to type `T`.

> A non-constant value `x` can be converted to type `T` in any of these cases:
>
> - `x` is assignable to `T`.
> - ignoring struct tags (see below), `x`'s type and `T` are not type parameters but have identical underlying types.
> - ignoring struct tags (see below), `x`'s type and `T` are pointer types that are not named types, and their pointer base types are not type parameters but have identical underlying types.
> - `x`'s type and `T` are both integer or floating point types.
> - `x`'s type and `T` are both complex types.
> - `x` is an integer or a slice of bytes or runes and `T` is a string type.
> - `x` is a string and `T` is a slice of bytes or runes.
> - `x` is a slice, `T` is an array [Go 1.20] or a pointer to an array [Go 1.17], and the slice and array types have identical element types.

### Conversions Between Numeric Types (from Go Language Specification)

> For the conversion of non-constant numeric values, the following rules apply:
>
> When converting between integer types, if the value is a signed integer, it is sign extended to implicit infinite precision; otherwise it is zero extended. It is then truncated to fit in the result type's size. For example, if `v := uint16(0x10F0)`, then `uint32(int8(v)) == 0xFFFFFFF0`. The conversion always yields a valid value; there is no indication of overflow.
>
> When converting a floating-point number to an integer, the fraction is discarded (truncation towards zero).
>
> When converting an integer or floating-point number to a floating-point type, or a complex number to another complex type, the result value is rounded to the precision specified by the destination type.
>
> In all non-constant conversions involving floating-point or complex values, if the result type cannot represent the value the conversion succeeds but the result value is implementation-dependent.

### Conversions to and from String (from Go Language Specification)

> Converting a slice of bytes to a string type yields a string whose successive bytes are the elements of the slice.

> Converting a slice of runes to a string type yields a string that is the concatenation of the individual rune values converted to strings.

> Converting a value of a string type to a slice of bytes type yields a non-nil slice whose successive elements are the bytes of the string.

> Converting a value of a string type to a slice of runes type yields a slice containing the individual Unicode code points of the string.

> Finally, for historical reasons, an integer value may be converted to a string type. This form of conversion yields a string containing the (possibly multi-byte) UTF-8 representation of the Unicode code point with the given integer value. Values outside the range of valid Unicode code points are converted to `"\uFFFD"`.
>
> **Note:** This form of conversion may eventually be removed from the language.

---

## 2. Formal Grammar

From the Go specification:

```ebnf
Conversion = Type "(" Expression [ "," ] ")" .
```

Examples of disambiguation when the type starts with `*`, `<-`, or `func`:

```
*Point(p)        // same as *(Point(p))
(*Point)(p)      // p is converted to *Point
<-chan int(c)    // same as <-(chan int(c))
(<-chan int)(c)  // c is converted to <-chan int
func()(x)        // function signature func() x
(func())(x)      // x is converted to func()
(func() int)(x)  // x is converted to func() int
func() int(x)    // x is converted to func() int (unambiguous)
```

---

## 3. Core Rules

### Rule 1: Conversion Syntax is T(x)
An explicit conversion uses the syntax `T(x)` where `T` is the target type and `x` is the value being converted.

### Rule 2: Conversions Are Not Implicit
Go does NOT perform implicit type conversions. You must write `T(x)` explicitly whenever the types differ (even if same size):

```go
var a int32 = 5
var b int64 = int64(a)  // explicit — required
// var b int64 = a      // COMPILE ERROR
```

### Rule 3: Conversion ≠ Assignment
Conversion and assignability are related but distinct:
- Assignability rules determine when `x = y` is valid
- Conversion rules determine when `T(x)` is valid
- Conversions are a superset: if `x` is assignable to `T`, then `T(x)` is also valid

### Rule 4: Constant Conversions Have Representability Requirement
From the spec:
> A constant value `x` can be converted to type `T` if `x` is representable by a value of `T`.

```go
uint(iota)               // valid: iota value of type uint
float32(2.718281828)     // valid
int(1.2)                 // COMPILE ERROR: 1.2 cannot be represented as int
string(65.0)             // COMPILE ERROR: 65.0 is not an integer constant
```

---

## 4. Type Rules

### Complete Conversion Rules Matrix

| Source Type | Target Type | Valid? | Notes |
|-------------|-------------|--------|-------|
| Any type | Same type | Yes | Trivial |
| `T` | `T` (assignable) | Yes | Subset of assignment |
| `T1` | `T2` (identical underlying) | Yes | Struct tags ignored |
| Integer | Integer | Yes | Sign/zero extension + truncation |
| Float | Integer | Yes | Fraction discarded (truncate toward 0) |
| Integer | Float | Yes | Rounded to target precision |
| Float32 | Float64 | Yes | Widening |
| Float64 | Float32 | Yes | Rounded to 32-bit precision |
| Complex | Complex | Yes | Each part rounded |
| Integer | String | Yes (deprecated) | UTF-8 of code point |
| `[]byte` | String | Yes | String with same bytes |
| `[]rune` | String | Yes | UTF-8 concatenation of runes |
| String | `[]byte` | Yes | Copy of bytes |
| String | `[]rune` | Yes | UTF-8 decoded code points |
| Slice | Array (Go 1.20) | Yes if element types equal | Length check at runtime |
| Slice | `*Array` (Go 1.17) | Yes if element types equal | nil if slice is nil |
| `bool` | Integer | **NO** — compile error | |
| Integer | `bool` | **NO** — compile error | |
| Float | String | **NO** — compile error | |

### Struct Tag Ignoring in Conversion
From the spec:
> Struct tags are ignored when comparing struct types for identity for the purpose of conversion.

```go
type Person struct {
    Name    string
    Address *struct {
        Street string
        City   string
    }
}

var data *struct {
    Name    string `json:"name"`
    Address *struct {
        Street string `json:"street"`
        City   string `json:"city"`
    } `json:"address"`
}

var person = (*Person)(data)  // valid: tags ignored, underlying types identical
```

---

## 5. Behavioral Specification

### Integer Conversion: Sign Extension / Zero Extension + Truncation
From the spec:

> When converting between integer types, if the value is a signed integer, it is sign extended to implicit infinite precision; otherwise it is zero extended. It is then truncated to fit in the result type's size.

**Signed → larger**: sign extended
```go
var a int8 = -1  // bits: 11111111
b := int16(a)    // sign extended: 1111111111111111 = -1
```

**Unsigned → larger**: zero extended
```go
var a uint8 = 0xFF  // bits: 11111111
b := uint16(a)      // zero extended: 0000000011111111 = 255
```

**Truncation (→ smaller)**:
```go
v := uint16(0x10F0)
a := int8(v)       // truncate to 8 bits: 0xF0 = -16 (as int8)
b := uint32(int8(v)) // sign-extend int8(-16) to uint32: 0xFFFFFFF0
```

### Float → Integer Conversion
From the spec:
> When converting a floating-point number to an integer, the fraction is discarded (truncation towards zero).

```go
int(1.9)    // 1 (not 2)
int(-1.9)   // -1 (not -2)
int(1.0)    // 1
```

### Integer → Float Conversion
From the spec:
> When converting an integer or floating-point number to a floating-point type, the result value is rounded to the precision specified by the destination type.

```go
float32(16777217) // may not equal 16777217 exactly (exceeds float32 precision)
float64(16777217) // precise: float64 has enough precision
```

### String ↔ []byte and []rune Conversions
From the spec:

```go
// From spec official examples:
string([]byte{'h', 'e', 'l', 'l', '\xc3', '\xb8'})   // "hellø"
string([]byte{})                                      // ""
string([]byte(nil))                                   // ""

string([]rune{0x767d, 0x9d6c, 0x7fd4})   // "\u767d\u9d6c\u7fd4" == "白鵬翔"
string([]rune{})                          // ""
string([]rune(nil))                       // ""

[]byte("hellø")    // []byte{'h', 'e', 'l', 'l', '\xc3', '\xb8'}
[]byte("")         // []byte{}

[]rune("白鵬翔")   // []rune{0x767d, 0x9d6c, 0x7fd4}
[]rune("")         // []rune{}
```

### Integer → String Conversion (Deprecated)
From the spec:
```go
string('a')          // "a"
string(65)           // "A"
string('\xf8')       // "\u00f8" == "ø" == "\xc3\xb8"
string(-1)           // "\ufffd" == "\xef\xbf\xbd"
```

---

## 6. Defined vs Undefined Behavior

### Defined by the Spec

| Conversion | Behavior |
|------------|----------|
| Integer narrowing | Always yields valid value; truncation defined |
| Float → Integer | Truncates toward zero |
| Integer → Float | Rounds to target precision |
| Float overflow in conversion | Succeeds; value is implementation-dependent |
| `string([]byte(nil))` | Returns `""` |
| `string([]rune(nil))` | Returns `""` |
| `[]byte("")` | Returns non-nil empty slice |
| `[]rune("")` | Returns non-nil empty slice |
| `string(-1)` | Returns `"\uFFFD"` |
| `string(0xD800)` | Returns `"\uFFFD"` (surrogate) |
| `string(0x10FFFF)` | Returns UTF-8 for U+10FFFF |
| `string(0x110000)` | Returns `"\uFFFD"` |

### Implementation-Dependent

| Conversion | Notes |
|------------|-------|
| Float → Float (overflow) | If value unrepresentable, result is implementation-dependent |
| Integer → Float (large values) | Rounding is implementation-defined within IEEE 754 rules |

---

## 7. Edge Cases from Spec

### Edge Case 1: Spec Example — uint32(int8(uint16(0x10F0)))
From the official spec:
```go
v := uint16(0x10F0)
result := uint32(int8(v))
// Step 1: uint16(0x10F0) = 0x10F0
// Step 2: int8(0x10F0) = int8(0xF0) = -16 (truncated to 8 bits, sign bit set)
// Step 3: uint32(int8(-16)) = uint32 of sign-extended -16 = 0xFFFFFFF0
fmt.Printf("0x%X\n", result)  // 0xFFFFFFF0
```

### Edge Case 2: Float Conversion of Large Integer
```go
var big int64 = 16777217  // 2^24 + 1
f32 := float32(big)
fmt.Println(f32)          // 1.6777216e+07 (not exact)
fmt.Println(int64(f32) == big)  // false (precision lost)

f64 := float64(big)
fmt.Println(int64(f64) == big)  // true (float64 has 53-bit mantissa)
```

### Edge Case 3: Slice to Array Conversion (Go 1.20)
```go
s := []int{1, 2, 3, 4, 5}
a := [3]int(s)  // first 3 elements
fmt.Println(a)  // [1 2 3]

// Panics at runtime if len(s) < len(array)
// a2 := [10]int(s)  // panic: cannot convert slice with length 5 to array or pointer to array with length 10
```

### Edge Case 4: Slice to Array Pointer (Go 1.17)
```go
s := []int{1, 2, 3}
p := (*[3]int)(s)      // points into s's backing array
p[0] = 99
fmt.Println(s[0])  // 99 (same memory)

var nilSlice []int
np := (*[0]int)(nilSlice)  // valid: nil slice to empty array pointer = nil
fmt.Println(np == nil)     // true
```

### Edge Case 5: Constant Conversion Examples from Spec
```go
uint(iota)               // iota value of type uint
float32(2.718281828)     // 2.718281828 of type float32
complex128(1)            // 1.0 + 0.0i of type complex128
float32(0.49999999)      // 0.5 of type float32 (rounded)
float64(-1e-1000)        // 0.0 of type float64 (underflow to zero)
string('x')              // "x" of type string
string(0x266c)           // "♬" of type string
myString("foo" + "bar")  // "foobar" of type myString
// string([]byte{'a'})   // not a constant: []byte{'a'} is not a constant
// int(1.2)              // COMPILE ERROR: 1.2 cannot be represented as int
// string(65.0)          // COMPILE ERROR: 65.0 is not an integer constant
```

---

## 8. Version History

| Go Version | Change |
|------------|--------|
| Go 1.0 | All numeric type conversions |
| Go 1.0 | `string`↔`[]byte`, `string`↔`[]rune` conversions |
| Go 1.0 | `string(integer)` conversion (deprecated style) |
| Go 1.9 | Type aliases (`byte = uint8`, `rune = int32`) are freely interchangeable |
| Go 1.15 | `go vet` warns about `string(integer)` conversion |
| Go 1.17 | Slice to pointer-to-array conversion: `(*[N]T)(slice)` |
| Go 1.20 | Slice to array conversion: `[N]T(slice)` |

---

## 9. Implementation-Specific Behavior

### Numeric Conversion
The gc compiler uses CPU native integer conversion instructions. The behavior matches the spec exactly (sign extension, zero extension, truncation).

### String ↔ []byte Performance
The gc compiler may optimize `[]byte(s)` to avoid copying in some contexts (read-only use). However, the spec guarantees the **semantic** of a full copy. Mutations of the resulting slice do not affect the original string.

### Float Extended Precision
As noted in the spec, intermediate float calculations may use extended precision (80-bit on x87). Converting `float32(expression)` forces rounding to float32 precision.

---

## 10. Spec Compliance Checklist

- [ ] Conversion syntax is `T(x)`, not a function call
- [ ] No implicit conversions — all type changes require explicit `T(x)`
- [ ] Integer narrowing: always valid, truncates to fit (no overflow error)
- [ ] Integer widening (signed): sign extension
- [ ] Integer widening (unsigned): zero extension
- [ ] Float → Integer: fraction discarded (truncate toward zero)
- [ ] Integer → Float: rounded to destination precision
- [ ] Float → Float: rounded to destination precision; no panic on overflow
- [ ] `string([]byte{...})` creates string with same bytes
- [ ] `string([]rune{...})` creates UTF-8 string
- [ ] `[]byte(string)` returns non-nil copy of bytes
- [ ] `[]rune(string)` returns UTF-8 decoded code points
- [ ] `string(nil []byte)` and `string(nil []rune)` return `""`
- [ ] `string(integer)` returns UTF-8 of code point (deprecated, not yet removed)
- [ ] `string(-1)` and `string(0xD800)` return `"\uFFFD"`
- [ ] Struct tags ignored when comparing types for conversion eligibility
- [ ] Slice to array (Go 1.20): panics if slice too short at runtime
- [ ] Slice to `*array` (Go 1.17): nil slice → nil pointer

---

## 11. Official Examples

### Example 1: Numeric Type Conversions

```go
package main

import "fmt"

func main() {
    // Integer to integer
    var a int8 = -1
    b := int16(a)   // sign extended: -1
    c := uint8(a)   // truncated: 255 (0xFF)
    fmt.Println(a, b, c) // -1 -1 255

    // Spec example: uint32(int8(uint16(0x10F0)))
    v := uint16(0x10F0)
    result := uint32(int8(v))
    fmt.Printf("0x%X\n", result) // 0xFFFFFFF0

    // Float to integer (truncation toward zero)
    fmt.Println(int(1.9))   //  1
    fmt.Println(int(-1.9))  // -1
    fmt.Println(int(3.0))   //  3

    // Integer to float (precision rounding)
    var bigInt int64 = 16777217 // 2^24 + 1
    fmt.Println(float32(bigInt)) // 1.6777216e+07 (precision lost)
    fmt.Println(float64(bigInt)) // 1.6777217e+07 (precise)
}
```

### Example 2: Official Spec Constant Conversion Examples

```go
package main

import "fmt"

type myString string

func main() {
    // From Go spec section on Conversions
    a := float32(2.718281828)
    fmt.Printf("%T: %v\n", a, a)  // float32: 2.718282

    b := complex128(1)
    fmt.Printf("%T: %v\n", b, b)  // complex128: (1+0i)

    c := float32(0.49999999)
    fmt.Printf("%T: %v\n", c, c)  // float32: 0.5 (rounded)

    d := float64(-1e-1000)
    fmt.Printf("%T: %v\n", d, d)  // float64: 0

    e := string('x')
    fmt.Printf("%T: %q\n", e, e)  // string: "x"

    f := string(0x266c)
    fmt.Printf("%T: %q\n", f, f)  // string: "♬"

    g := myString("foo" + "bar")
    fmt.Printf("%T: %q\n", g, g)  // main.myString: "foobar"
}
```

### Example 3: String ↔ []byte ↔ []rune Conversions (from Spec)

```go
package main

import "fmt"

func main() {
    // Spec examples: []byte to string
    s1 := string([]byte{'h', 'e', 'l', 'l', '\xc3', '\xb8'})
    fmt.Println(s1)  // "hellø"

    s2 := string([]byte{})
    fmt.Printf("%q, len=%d\n", s2, len(s2))  // "", len=0

    s3 := string([]byte(nil))
    fmt.Printf("%q, len=%d\n", s3, len(s3))  // "", len=0

    // Spec examples: []rune to string
    s4 := string([]rune{0x767d, 0x9d6c, 0x7fd4})
    fmt.Println(s4)  // 白鵬翔

    // Spec examples: string to []byte
    b := []byte("hellø")
    fmt.Printf("% X\n", b)  // 68 65 6C 6C C3 B8

    // Spec examples: string to []rune
    r := []rune("白鵬翔")
    fmt.Printf("%X\n", r)  // [767D 9D6C 7FD4]
}
```

### Example 4: integer → string Conversion (Deprecated Form)

```go
package main

import "fmt"

func main() {
    // From Go spec (noted as potentially removed in future)
    fmt.Println(string('a'))      // "a"
    fmt.Println(string(65))       // "A"
    fmt.Println(string('\xf8'))   // "ø" (U+00F8, UTF-8: c3 b8)
    fmt.Println(string(-1))       // "\uFFFD" (invalid code point → replacement)
    fmt.Println(string(0xD800))   // "\uFFFD" (surrogate half → replacement)
    fmt.Println(string(0x10FFFF)) // valid last code point

    // PREFERRED way (since Go 1.15+, avoids vet warning):
    fmt.Println(string(rune(65))) // "A" — explicit rune conversion
}
```

### Example 5: Slice to Array Conversion (Go 1.17 and Go 1.20)

```go
package main

import "fmt"

func main() {
    s := []int{1, 2, 3, 4, 5}

    // Go 1.17: slice to pointer to array
    p := (*[3]int)(s)
    fmt.Println(*p)  // [1 2 3]
    p[0] = 99
    fmt.Println(s[0])  // 99 (shares memory!)

    // Go 1.20: slice to array (copy)
    a := [3]int(s)
    fmt.Println(a)    // [99 2 3] (copy of first 3 elements)
    a[0] = 0
    fmt.Println(s[0]) // 99 (no sharing)

    // Nil slice
    var nilSlice []int
    np := (*[0]int)(nilSlice)  // valid: nil result
    fmt.Println(np == nil)     // true
}
```

### Example 6: Named Type Conversions

```go
package main

import "fmt"

type Celsius    float64
type Fahrenheit float64

func CtoF(c Celsius) Fahrenheit {
    return Fahrenheit(c*9/5 + 32)
}

func FtoC(f Fahrenheit) Celsius {
    return Celsius((f - 32) * 5 / 9)
}

func main() {
    boiling := Celsius(100)
    fmt.Printf("%.1f°C = %.1f°F\n", boiling, CtoF(boiling))

    freezing := Fahrenheit(32)
    fmt.Printf("%.1f°F = %.1f°C\n", freezing, FtoC(freezing))

    // Both Celsius and Fahrenheit have float64 as underlying type
    // Conversion between them is valid
    var c Celsius = 37
    var f Fahrenheit = Fahrenheit(c)  // explicit conversion required
    _ = f
}
```

---

## 12. Related Spec Sections

| Section | URL | Relevance |
|---------|-----|-----------|
| Conversions | https://go.dev/ref/spec#Conversions | Core conversion rules |
| Assignability | https://go.dev/ref/spec#Assignability | Related but distinct concept |
| Numeric types | https://go.dev/ref/spec#Numeric_types | Types involved in numeric conversions |
| String types | https://go.dev/ref/spec#String_types | String conversion behavior |
| Type identity | https://go.dev/ref/spec#Type_identity | When two types are identical |
| Underlying types | https://go.dev/ref/spec#Underlying_types | Key concept for conversion rules |
| Constants | https://go.dev/ref/spec#Constants | Constant conversion representability |
| Type parameters | https://go.dev/ref/spec#Conversions | Conversion rules with generics |
| unsafe package | https://pkg.go.dev/unsafe | `unsafe.Pointer` conversions |
| strconv | https://pkg.go.dev/strconv | String ↔ numeric conversions |
| fmt | https://pkg.go.dev/fmt | Formatted output with type info |
