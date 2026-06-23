# Methods on Defined Types — Junior Level

## Table of Contents
1. [Introduction](#introduction)
2. [Prerequisites](#prerequisites)
3. [Glossary](#glossary)
4. [What Is a Defined Type?](#what-is-a-defined-type)
5. [Methods on Primitive-Backed Types](#methods-on-primitive-backed-types)
6. [Methods on String-Backed Types](#methods-on-string-backed-types)
7. [Methods on Slice-Backed Types](#methods-on-slice-backed-types)
8. [Why Not Just Use the Built-in Type?](#why-not-just-use-the-built-in-type)
9. [Defined Type vs Type Alias](#defined-type-vs-type-alias)
10. [Conversions Between Defined Type and Underlying Type](#conversions-between-defined-type-and-underlying-type)
11. [Real-World Examples in the Standard Library](#real-world-examples-in-the-standard-library)
12. [Common Mistakes](#common-mistakes)
13. [Edge Cases & Pitfalls](#edge-cases-pitfalls)
14. [Test](#test)
15. [Cheat Sheet](#cheat-sheet)
16. [Self-Assessment Checklist](#self-assessment-checklist)
17. [Summary](#summary)
18. [Further Reading](#further-reading)

---

## Introduction
> Focus: "Methods do not need a struct."

Most Go tutorials show you methods on structs and stop there. But Go's `type` keyword can wrap **any** existing type — and the resulting "defined type" can carry its own methods. That means you can write:

```go
type Counter int

func (c Counter) Double() Counter { return c * 2 }
```

Here the receiver is **not** a struct — it is `Counter`, a defined type whose underlying type is `int`. The method `Double` belongs to `Counter` exactly the way `Area` belonged to `Rectangle` in earlier sections.

This unlocks a different style of code:

- Domain primitives (`type UserID string`, `type OrderID int64`)
- Sortable slices (`type IntSlice []int` with `Len`/`Less`/`Swap`)
- Function adapters (`type HandlerFunc func(...)` — see `net/http`)
- Time and unit types (`time.Duration` is `int64` underneath)

After reading this file you will be able to:

- Recognize a defined type vs the built-in it wraps
- Attach methods to non-struct types
- Convert between a defined type and its underlying form
- Tell a defined type apart from a type alias

---

## Prerequisites

- You can write a basic struct and a method on it (sections 01-03)
- You understand value vs pointer receivers
- You know the difference between exported (`Foo`) and unexported (`foo`) names
- You have written at least one method before

---

## Glossary

| Term | Definition |
|------|------------|
| **Defined type** | A new named type introduced by `type X Y` — distinct from `Y` |
| **Underlying type** | The type `X` is built on (`int`, `[]string`, `func(...)`, etc.) |
| **Type alias** | `type X = Y` — `X` is just another name for the same type |
| **Receiver base type** | The type a method is bound to |
| **Built-in type** | Predeclared types like `int`, `string`, `bool`, `byte`, `rune` |
| **Domain primitive** | A defined type that wraps a primitive to give it semantic meaning |
| **Zero-cost wrapper** | A defined type that adds no runtime overhead, only type safety |
| **Type conversion** | `T(v)` — converting a value to type `T` (compile-time check) |

---

## What Is a Defined Type?

A defined type is what you get when you say:

```go
type Celsius float64
```

After this declaration, `Celsius` is a brand-new type. Its **underlying type** is `float64`, but `Celsius` and `float64` are **not** the same type. The compiler will not let you mix them without an explicit conversion:

```go
var t Celsius = 36.6
var f float64 = 36.6

// t = f          // ERROR: cannot use f (float64) as Celsius
// f = t          // ERROR: cannot use t (Celsius) as float64

t = Celsius(f)    // OK — explicit conversion
f = float64(t)    // OK — explicit conversion
```

This isolation is a feature, not a limitation. The compiler now stops you from accidentally adding a temperature to a distance just because both are `float64`.

And — here is the key point of this whole section — a defined type can have **methods**:

```go
func (c Celsius) Fahrenheit() float64 {
    return float64(c)*9/5 + 32
}

t := Celsius(36.6)
fmt.Println(t.Fahrenheit()) // 97.88
```

You did not need a struct. The receiver is a value of type `Celsius`, which is a defined type whose underlying type is a plain `float64`.

---

## Methods on Primitive-Backed Types

### Counter — methods on `int`

```go
package main

import "fmt"

type Counter int

func (c Counter) Increment() Counter {
    return c + 1
}

func (c Counter) IsPositive() bool {
    return c > 0
}

func main() {
    var c Counter = 5
    c = c.Increment()
    fmt.Println(c)             // 6
    fmt.Println(c.IsPositive()) // true
}
```

Notice the value receiver `(c Counter)`. Every call gets a copy of the underlying integer. Returning a new `Counter` is the immutable style, common when wrapping primitives.

If you want to mutate in place, take a pointer receiver:

```go
func (c *Counter) Add(n int) {
    *c += Counter(n)
}

var c Counter
c.Add(5)
c.Add(3)
fmt.Println(c) // 8
```

### Why this works

`Counter`'s underlying type is `int`. Inside the method body, the receiver `c` behaves like an integer for all the operations the underlying type allows: `+`, `-`, `*`, comparison, and so on. Only the **identity** is different — `Counter(5)` is not `int(5)` to the type system.

### ErrCode — int as an error code

A favorite pattern: a numeric error code that satisfies the `error` interface.

```go
type ErrCode int

const (
    ErrNotFound  ErrCode = 404
    ErrForbidden ErrCode = 403
    ErrInternal  ErrCode = 500
)

func (e ErrCode) Error() string {
    switch e {
    case ErrNotFound:  return "not found"
    case ErrForbidden: return "forbidden"
    case ErrInternal:  return "internal error"
    }
    return "unknown"
}

func main() {
    var err error = ErrNotFound
    fmt.Println(err) // not found
}
```

`ErrCode`'s underlying type is `int`, but it implements the `error` interface because it has an `Error() string` method. We will revisit this in `senior.md` and `professional.md`.

---

## Methods on String-Backed Types

### Email — methods on `string`

```go
package main

import (
    "fmt"
    "strings"
)

type Email string

func (e Email) Domain() string {
    if i := strings.IndexByte(string(e), '@'); i >= 0 {
        return string(e[i+1:])
    }
    return ""
}

func (e Email) Valid() bool {
    return strings.Contains(string(e), "@")
}

func main() {
    var addr Email = "alice@example.com"
    fmt.Println(addr.Domain()) // example.com
    fmt.Println(addr.Valid())  // true
}
```

Two things to notice:

1. Inside the methods we cast `e` to `string` when we need to call `strings.IndexByte` or `strings.Contains`. Those library functions accept a plain `string`, not an `Email`.
2. The slice expression `e[i+1:]` returns a slice of the underlying type — also of type `Email` here, because slicing preserves the type. We convert with `string(...)` only because the function signature says `string`.

### UserID — string as an opaque identifier

```go
type UserID string

func (id UserID) IsAnonymous() bool {
    return id == "" || string(id) == "anonymous"
}

func (id UserID) String() string {
    return "user:" + string(id)
}
```

`UserID` makes the API self-documenting: `func GetUser(id UserID)` is far clearer than `func GetUser(id string)`.

---

## Methods on Slice-Backed Types

### IntSlice — sum, max, sort

```go
package main

import "fmt"

type IntSlice []int

func (s IntSlice) Sum() int {
    total := 0
    for _, v := range s {
        total += v
    }
    return total
}

func (s IntSlice) Max() int {
    if len(s) == 0 {
        return 0
    }
    m := s[0]
    for _, v := range s[1:] {
        if v > m {
            m = v
        }
    }
    return m
}

func main() {
    nums := IntSlice{3, 1, 4, 1, 5, 9, 2, 6}
    fmt.Println(nums.Sum()) // 31
    fmt.Println(nums.Max()) // 9
}
```

The receiver is a value receiver. A slice header is small (pointer + length + capacity = 24 bytes on 64-bit), so copying it is cheap, and the underlying array is shared. We will discuss this nuance more in `optimize.md`.

### You cannot do this on `[]int` directly

```go
// ERROR — cannot define methods on the unnamed type []int
// func (s []int) Sum() int { ... }
```

The receiver type **must be a defined (named) type**. `[]int` is an unnamed (literal) slice type, so it cannot host methods. This is precisely why `IntSlice` exists in `sort.IntSlice`.

---

## Why Not Just Use the Built-in Type?

Three reasons:

**1. Type safety.** With `type UserID string`, you cannot accidentally pass an `OrderID` where the API wants a `UserID`, even though both are strings underneath.

```go
type UserID string
type OrderID string

func GetUser(id UserID) {}

var oid OrderID = "o-1"
// GetUser(oid)         // compile error — caught at build time
GetUser(UserID(oid))    // explicit conversion required
```

**2. Methods.** You cannot write `func (s string) Reverse() string` — the spec forbids methods on built-in types. By defining `type MyString string`, you can.

**3. Domain meaning.** `time.Duration` is `int64`, but `time.Duration(5*time.Second)` reads very differently from `int64(5_000_000_000)`. The defined type tells the reader, "this is not just a number — it is a duration."

---

## Defined Type vs Type Alias

```go
type IntDefined int    // defined type — separate identity
type IntAlias  = int   // alias — same type, just a new name
```

Methods can be added to the **defined type**, not to the alias.

```go
type IntDefined int
func (i IntDefined) Double() IntDefined { return i * 2 } // OK

type IntAlias = int
// func (i IntAlias) Double() int { return i * 2 } // ERROR — same as `func (i int) Double()`
```

Why is the alias case an error? Because `IntAlias` literally **is** `int`. Adding a method to the alias would mean adding a method to `int`, which the language disallows.

A handy way to see it:

| Form | Reads as | Methods allowed |
|------|----------|----------------|
| `type X Y` | "X is a new type whose underlying type is Y" | Yes |
| `type X = Y` | "X is another name for Y" | No (unless Y itself allows them) |

The `=` is the difference. Miss it and your method either compiles when you didn't want it to, or fails to compile when you expected success. We will see real bugs around this in `find-bug.md`.

---

## Conversions Between Defined Type and Underlying Type

A defined type and its underlying type are convertible without data movement at runtime:

```go
type Counter int

var c Counter = 5
var n int = int(c)      // explicit conversion
c = Counter(n)          // back

fmt.Println(c, n) // 5 5
```

The conversion is purely a type-level relabel — it costs nothing at runtime. This is why we call defined types **zero-cost wrappers**.

Untyped constants relax this slightly:

```go
type Counter int
var c Counter = 5   // 5 is an untyped constant — assignable to Counter
```

But typed `int` is not auto-convertible:

```go
var n int = 5
var c Counter = n   // ERROR
var c Counter = Counter(n) // OK
```

---

## Real-World Examples in the Standard Library

The standard library is full of methods on non-struct defined types. Here are the names you will run into immediately:

| Name | Underlying type | Methods (selected) |
|------|----------------|-------------------|
| `time.Duration` | `int64` | `String`, `Hours`, `Minutes`, `Seconds`, `Milliseconds`, `Microseconds`, `Nanoseconds`, `Round`, `Truncate` |
| `time.Weekday` | `int` | `String` |
| `os.FileMode` | `uint32` | `IsDir`, `IsRegular`, `Perm`, `String` |
| `sort.IntSlice` | `[]int` | `Len`, `Less`, `Swap`, `Sort`, `Search` |
| `sort.StringSlice` | `[]string` | `Len`, `Less`, `Swap`, `Sort`, `Search` |
| `sort.Float64Slice` | `[]float64` | `Len`, `Less`, `Swap`, `Sort`, `Search` |
| `http.HandlerFunc` | `func(http.ResponseWriter, *http.Request)` | `ServeHTTP` |
| `http.Header` | `map[string][]string` | `Get`, `Set`, `Add`, `Del`, `Values` |

Quick demonstration of `time.Duration`:

```go
import (
    "fmt"
    "time"
)

func main() {
    d := 90 * time.Second
    fmt.Println(d)            // 1m30s — uses Duration.String()
    fmt.Println(d.Minutes())  // 1.5
    fmt.Println(d.Seconds())  // 90
}
```

Behind the scenes:

```go
// In the standard library:
type Duration int64

func (d Duration) Seconds() float64 { ... }
```

The fact that `time.Duration` is `int64` matters: arithmetic like `5 * time.Second` works because `time.Second` is a `Duration` constant, and `5` is an untyped constant that adapts to `Duration`.

---

## Common Mistakes

| Mistake | Why it fails | Fix |
|---------|------|-----|
| `func (i int) Double() int` | Cannot add methods to a built-in | `type MyInt int` and method on `MyInt` |
| `func (s []int) Sum() int` | `[]int` is unnamed | `type IntSlice []int` |
| `type X = Y` then methods on X | `=` makes it an alias | Drop the `=` |
| Mixing `int` and `Counter` arithmetic | Different types | `Counter(n)` or `int(c)` |
| Adding a method to `time.Time` directly | Cross-package | Wrap: `type MyTime time.Time` |
| Defining methods on `byte`/`rune` | Both are aliases (`= uint8`/`= int32`) | `type MyByte byte` (a fresh defined type) |

---

## Edge Cases & Pitfalls

### Pitfall 1: `byte` and `rune` are aliases

```go
// In the spec:
//   type byte = uint8
//   type rune = int32

// You cannot add methods to byte or rune
// because they are aliases for uint8 / int32.

// func (b byte) IsLetter() bool { ... }   // ERROR

type MyByte byte
func (b MyByte) IsLetter() bool {
    return ('a' <= b && b <= 'z') || ('A' <= b && b <= 'Z')
}
```

### Pitfall 2: Slicing produces the same defined type

```go
type IntSlice []int

func (s IntSlice) Head() IntSlice {
    if len(s) == 0 { return nil }
    return s[:1]   // type is still IntSlice
}
```

This is convenient — methods chain naturally. Slicing does not "demote" you to `[]int`.

### Pitfall 3: Untyped constants vs typed values

```go
type Celsius float64

var t Celsius = 36.6   // OK — 36.6 is untyped, adapts to Celsius
var f float64 = 36.6
// t = f               // ERROR — typed float64
t = Celsius(f)         // OK
```

### Pitfall 4: Cross-package methods are forbidden

```go
import "time"

// func (t time.Time) IsLeap() bool { ... }   // ERROR
// "cannot define new methods on non-local type time.Time"
```

The fix: wrap.

```go
type MyTime struct{ time.Time }

func (t MyTime) IsLeap() bool {
    y := t.Year()
    return y%4 == 0 && (y%100 != 0 || y%400 == 0)
}
```

(More on wrapping cross-package types in section 18.)

---

## Test

### 1. Which of the following will compile?

```go
type A int
type B = int

func (a A) Foo() {} // (1)
func (b B) Bar() {} // (2)
```

- a) Both
- b) Only (1)
- c) Only (2)
- d) Neither

**Answer: b** — `B` is an alias of `int`; methods on `int` are forbidden.

### 2. What is the underlying type of `time.Duration`?

- a) `time.Time`
- b) `int64`
- c) `float64`
- d) `string`

**Answer: b** — `type Duration int64` in the standard library.

### 3. Why can `sort.IntSlice` have `Len()`, `Less()`, `Swap()` methods, but `[]int` cannot?

- a) Performance reasons
- b) `IntSlice` is a defined type; `[]int` is an unnamed type
- c) `[]int` is a built-in type
- d) The methods are on the elements

**Answer: b**

### 4. Which line below will NOT compile?

```go
type Counter int

var c Counter = 5
var n int = 5

c = Counter(n)        // (a)
n = int(c)            // (b)
c = n                 // (c)
c = c + 1             // (d)
```

**Answer: c** — `n` is a typed `int`; you must convert it to `Counter`.

### 5. Why is `type MyByte byte` legal but `func (b byte) Foo() {}` illegal?

- a) `byte` is a struct
- b) `byte` is an alias for `uint8`; `MyByte` is a defined type
- c) Performance
- d) Compiler bug

**Answer: b**

---

## Cheat Sheet

```
DEFINED TYPE
────────────────────────────────
type X Y          new type, underlying = Y
type X = Y        alias, X *is* Y

METHODS ON DEFINED TYPES
────────────────────────────────
type Counter int
func (c Counter) Double() Counter { return c * 2 }

type Email string
func (e Email) Domain() string { ... }

type IntSlice []int
func (s IntSlice) Sum() int { ... }

NOT ALLOWED
────────────────────────────────
* method on a built-in type            (int, string, byte, rune ...)
* method on an unnamed type            ([]int, map[string]int)
* method on a type alias               (type X = Y)
* method on a type from another pkg    (time.Time, http.Request ...)

CONVERSION
────────────────────────────────
Counter(n)  int -> Counter (zero-cost)
int(c)      Counter -> int (zero-cost)

STD LIB EXAMPLES
────────────────────────────────
time.Duration   int64
sort.IntSlice   []int
http.HandlerFunc func(...)
http.Header     map[string][]string
os.FileMode     uint32
```

---

## Self-Assessment Checklist

- [ ] I can attach a method to `type Counter int`
- [ ] I can attach a method to `type Email string`
- [ ] I can attach a method to `type IntSlice []int`
- [ ] I can explain why I cannot define a method on `[]int` directly
- [ ] I know why `type X = Y` and `type X Y` differ for methods
- [ ] I know that `byte` and `rune` are aliases and so cannot host methods
- [ ] I can name three standard library defined types with methods on non-struct underlying types
- [ ] I can convert between a defined type and its underlying type

---

## Summary

A method's receiver does not need to be a struct. It needs to be a **defined type** that lives in the **same package**. That opens the door to:

- Primitive wrappers (`type Counter int`, `type Celsius float64`)
- String-based identifiers (`type UserID string`)
- Slice helpers (`type IntSlice []int` — used by `sort`)
- Many of the most useful types in the standard library (`time.Duration`, `os.FileMode`, `http.Header`)

Two restrictions to remember: no methods on **aliases** (`type X = Y`), and no methods on types from **other packages**. Everything else flows from the basic syntax you already know — the receiver just happens to be a non-struct.

The next file (`middle.md`) takes this further into **function types** (`http.HandlerFunc`'s `ServeHTTP`), **map types** (`http.Header.Get/Set`), and the standard `sort` interface implementation.

---

## Further Reading

- [Go Spec — Type definitions](https://go.dev/ref/spec#Type_definitions)
- [Go Spec — Type identity (alias rules)](https://go.dev/ref/spec#Type_identity)
- [Go Spec — Method declarations](https://go.dev/ref/spec#Method_declarations)
- [pkg.go.dev — time.Duration](https://pkg.go.dev/time#Duration)
- [pkg.go.dev — sort.IntSlice](https://pkg.go.dev/sort#IntSlice)
- [pkg.go.dev — net/http.HandlerFunc](https://pkg.go.dev/net/http#HandlerFunc)
- [Effective Go — The Stringer interface](https://go.dev/doc/effective_go#interface_methods)
