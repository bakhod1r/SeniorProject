# 8.20 `strconv` — Junior

> This file is for developers who are new to Go's `strconv` package.
> You will learn how to convert between strings and numbers or booleans,
> how to handle conversion errors, and what mistakes to avoid in
> everyday code.

---

## 1. Introduction

### What is it?

`strconv` is the standard library package for converting primitive Go
values — integers, floats, booleans — to and from their string
representations. It lives at
[`pkg.go.dev/strconv`](https://pkg.go.dev/strconv) and has been part
of the standard library since Go 1.0.

### How to use it?

```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // string → int
    n, err := strconv.Atoi("42")
    if err != nil {
        panic(err)
    }
    fmt.Println(n + 1) // 43

    // int → string
    s := strconv.Itoa(n)
    fmt.Println(s) // "42"
}
```

---

## 2. Prerequisites

- Variables and basic types (`int`, `int64`, `float64`, `bool`, `string`).
- Go error handling: `if err != nil { ... }`.
- Import statements.

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| Parse | Convert a string into a typed value |
| Format | Convert a typed value into a string |
| Base | Numeric radix: base 10 = decimal, base 16 = hex, base 2 = binary |
| bitSize | The target int/float bit width: 8, 16, 32, or 64 |
| `*NumError` | Error type returned by all `Parse*` functions |
| `ErrSyntax` | Sentinel: the string cannot be parsed as the requested type |
| `ErrRange` | Sentinel: the value is out of range for the requested type |
| Sentinel | A package-level error value you can compare with `errors.Is` |

---

## 4. The Two Families: `Parse*` and `Format*`

`strconv` has two symmetrical families:

```
"42"  ── Parse*  ──▶  42
 42   ── Format* ──▶ "42"
```

| Direction | Functions |
|-----------|----------|
| string → type | `ParseInt`, `ParseFloat`, `ParseBool`, `ParseUint` |
| type → string | `FormatInt`, `FormatFloat`, `FormatBool`, `FormatUint` |

For everyday `string ↔ int` work, use the shortcuts `Atoi` (ASCII to
integer) and `Itoa` (integer to ASCII) — they wrap `ParseInt` /
`FormatInt` for base-10 `int`.

---

## 5. `strconv.Atoi` and `strconv.Itoa`

These two functions handle the most common case: converting between a
decimal string and a plain Go `int`.

### 5.1 `Atoi` — string to int

```go
n, err := strconv.Atoi("123")
if err != nil {
    // err is *strconv.NumError
    fmt.Println("cannot convert:", err)
    return
}
fmt.Println(n * 2) // 246
```

`Atoi` returns `(int, error)`. Always check the error — on failure `n`
is `0` and `err` is non-nil.

```go
// What Atoi rejects
_, err = strconv.Atoi("123abc") // ErrSyntax
_, err = strconv.Atoi(" 42")   // ErrSyntax — leading space
_, err = strconv.Atoi("")       // ErrSyntax
_, err = strconv.Atoi("99999999999999999999999") // ErrRange
```

### 5.2 `Itoa` — int to string

```go
s := strconv.Itoa(255)
fmt.Println(s) // "255"
```

`Itoa` never fails and never returns an error. It always produces a
decimal string.

### 5.3 Atoi vs Itoa at a glance

```go
// Atoi: string → int (may fail)
n, err := strconv.Atoi("42")

// Itoa: int → string (always succeeds)
s := strconv.Itoa(42)
```

---

## 6. `strconv.ParseInt` — full control

`Atoi` is a shortcut for `ParseInt(s, 10, 0)`. When you need a
specific base or bit width, use `ParseInt` directly.

```go
func ParseInt(s string, base int, bitSize int) (int64, error)
```

| Parameter | Meaning |
|-----------|--------|
| `s` | The string to parse |
| `base` | 0, 2–36. 0 means infer from prefix (`0x`=hex, `0b`=binary, `0o`=octal, else decimal) |
| `bitSize` | 0 (= `int`), 8, 16, 32, 64 — the range the result must fit in |

The return type is always `int64`; cast to the desired width after.

### 6.1 Base 10 (decimal)

```go
n, err := strconv.ParseInt("255", 10, 64)
if err != nil {
    log.Fatal(err)
}
fmt.Println(n) // 255
```

### 6.2 Base 16 (hexadecimal)

```go
n, err := strconv.ParseInt("ff", 16, 64)
if err != nil {
    log.Fatal(err)
}
fmt.Println(n) // 255

// With 0x prefix — use base 0 to auto-detect
n, err = strconv.ParseInt("0xff", 0, 64)
fmt.Println(n) // 255
```

### 6.3 Base 2 (binary)

```go
n, err := strconv.ParseInt("1010", 2, 64)
if err != nil {
    log.Fatal(err)
}
fmt.Println(n) // 10
```

### 6.4 bitSize controls the valid range

```go
// bitSize 32 — result must fit in int32
n, err := strconv.ParseInt("2147483648", 10, 32) // max int32 is 2147483647
if err != nil {
    fmt.Println(err) // strconv.ParseInt: parsing "2147483648": value out of range
}

// bitSize 64 — result must fit in int64
n, err = strconv.ParseInt("2147483648", 10, 64) // fine
fmt.Println(n) // 2147483648
```

Setting the correct `bitSize` lets `ParseInt` range-check for you so
you don't need a manual bounds check.

### 6.5 Cast after parsing

```go
n64, _ := strconv.ParseInt("100", 10, 32)
n32 := int32(n64) // safe — bitSize 32 guarantees it fits
```

---

## 7. `strconv.ParseFloat`

```go
func ParseFloat(s string, bitSize int) (float64, error)
```

`bitSize` is 32 or 64. For `float32` use 32; for `float64` use 64.
The return type is always `float64`.

### 7.1 Basic use

```go
f, err := strconv.ParseFloat("3.14159", 64)
if err != nil {
    log.Fatal(err)
}
fmt.Println(f) // 3.14159
```

### 7.2 bitSize 32 vs 64

```go
// bitSize 64 — full precision
f64, _ := strconv.ParseFloat("1.0000001", 64)
fmt.Printf("%.7f\n", f64) // 1.0000001

// bitSize 32 — float32 precision, still returned as float64
f32, _ := strconv.ParseFloat("1.0000001", 32)
fmt.Printf("%.7f\n", f32) // 1.0000001 (but stored at float32 precision)
v := float32(f32)
fmt.Printf("%.7f\n", v)   // 1.0000001 (float32 rounds it)
```

Always use `bitSize 64` when you're storing into `float64`. Use
`bitSize 32` only when you'll immediately cast to `float32`.

### 7.3 NaN and Infinity

`ParseFloat` accepts "NaN", "Inf", "+Inf", "-Inf" (case-insensitive):

```go
f, _ := strconv.ParseFloat("Inf", 64)
fmt.Println(math.IsInf(f, 1)) // true

f, _ = strconv.ParseFloat("NaN", 64)
fmt.Println(math.IsNaN(f)) // true
```

### 7.4 What ParseFloat rejects

```go
_, err := strconv.ParseFloat("3.14abc", 64) // ErrSyntax
_, err  = strconv.ParseFloat("", 64)        // ErrSyntax
_, err  = strconv.ParseFloat(" 3.14", 64)   // ErrSyntax — leading space
```

---

## 8. `strconv.ParseBool`

```go
func ParseBool(s string) (bool, error)
```

Accepts: `"1"`, `"t"`, `"T"`, `"TRUE"`, `"true"`, `"True"`,
`"0"`, `"f"`, `"F"`, `"FALSE"`, `"false"`, `"False"`.

Anything else returns `ErrSyntax`.

```go
b, err := strconv.ParseBool("true")
fmt.Println(b, err) // true <nil>

b, err = strconv.ParseBool("1")
fmt.Println(b, err) // true <nil>

b, err = strconv.ParseBool("yes")
fmt.Println(b, err) // false strconv.ParseBool: parsing "yes": invalid syntax
```

`ParseBool` is useful for environment variables like `DEBUG=true`.

```go
debug, err := strconv.ParseBool(os.Getenv("DEBUG"))
if err != nil {
    debug = false // default to false if unset or invalid
}
```

---

## 9. `strconv.FormatInt`

```go
func FormatInt(i int64, base int) string
```

Converts an integer to its string representation in the given base.

```go
fmt.Println(strconv.FormatInt(255, 10))  // "255"
fmt.Println(strconv.FormatInt(255, 16))  // "ff"
fmt.Println(strconv.FormatInt(255, 2))   // "11111111"
fmt.Println(strconv.FormatInt(255, 8))   // "377"
fmt.Println(strconv.FormatInt(-42, 10))  // "-42"
```

`FormatInt` handles negative numbers correctly. It never produces a
leading "0x" or "0b" — the prefix is for `ParseInt` input only.

### `FormatUint` — unsigned integers

```go
func FormatUint(i uint64, base int) string

fmt.Println(strconv.FormatUint(255, 16)) // "ff"
```

---

## 10. `strconv.FormatFloat`

```go
func FormatFloat(f float64, fmt byte, prec, bitSize int) string
```

| Parameter | Meaning |
|-----------|--------|
| `f` | The float to format |
| `fmt` | Format character: `'f'`, `'e'`, `'g'`, `'E'`, `'G'`, `'b'`, `'x'` |
| `prec` | Digits; `-1` means shortest representation that round-trips |
| `bitSize` | 32 or 64 |

### Common format characters

| Char | Example output for 3.14159 |
|------|--------------------------|
| `'f'` | `3.14159` |
| `'e'` | `3.14159e+00` |
| `'g'` | `3.14159` (shortest of e/f) |

### Examples

```go
fmt.Println(strconv.FormatFloat(3.14159, 'f', 2, 64))  // "3.14"
fmt.Println(strconv.FormatFloat(3.14159, 'f', -1, 64)) // "3.14159"
fmt.Println(strconv.FormatFloat(3.14159, 'e', 2, 64))  // "3.14e+00"
fmt.Println(strconv.FormatFloat(3.14159, 'g', -1, 64)) // "3.14159"
```

Use `prec: -1` when you want the shortest string that parses back to
the same float — the default for serialisation.

---

## 11. `strconv.FormatBool`

```go
func FormatBool(b bool) string

fmt.Println(strconv.FormatBool(true))  // "true"
fmt.Println(strconv.FormatBool(false)) // "false"
```

`FormatBool` never fails. It always returns `"true"` or `"false"`.

---

## 12. Error Handling

### 12.1 The `*NumError` type

Every `Parse*` function returns a `*strconv.NumError` on failure:

```go
type NumError struct {
    Func string // e.g. "ParseInt"
    Num  string // the input string
    Err  error  // strconv.ErrSyntax or strconv.ErrRange
}
```

`NumError` implements the `error` interface. Its `Error()` string
looks like:

```
strconv.ParseInt: parsing "abc": invalid syntax
strconv.ParseFloat: parsing "1e999": value out of range
```

### 12.2 Checking the kind of error

Use `errors.Is` to distinguish between syntax errors and range errors:

```go
import (
    "errors"
    "strconv"
)

n, err := strconv.ParseInt("abc", 10, 64)
if err != nil {
    if errors.Is(err, strconv.ErrSyntax) {
        fmt.Println("not a number")
    } else if errors.Is(err, strconv.ErrRange) {
        fmt.Println("number too big or too small")
    }
}
```

You can also type-assert to `*NumError` to read the Func and Num
fields:

```go
var numErr *strconv.NumError
if errors.As(err, &numErr) {
    fmt.Printf("function %s failed on input %q\n", numErr.Func, numErr.Num)
}
```

### 12.3 `ErrSyntax` vs `ErrRange`

| Sentinel | Meaning | Example input |
|----------|---------|--------------|
| `ErrSyntax` | Not a valid representation | `"abc"`, `"3.x"`, `" 1"` |
| `ErrRange` | Valid syntax but out of range | `"999999999999999999999"` for int8 |

### 12.4 Full error-handling example

```go
package main

import (
    "errors"
    "fmt"
    "strconv"
)

func parsePort(s string) (int, error) {
    n, err := strconv.ParseInt(s, 10, 32)
    if err != nil {
        if errors.Is(err, strconv.ErrSyntax) {
            return 0, fmt.Errorf("port %q is not a number", s)
        }
        if errors.Is(err, strconv.ErrRange) {
            return 0, fmt.Errorf("port %q is out of int32 range", s)
        }
        return 0, err
    }
    port := int(n)
    if port < 1 || port > 65535 {
        return 0, fmt.Errorf("port %d out of valid range 1-65535", port)
    }
    return port, nil
}

func main() {
    tests := []string{"8080", "0", "65536", "abc", ""}
    for _, s := range tests {
        p, err := parsePort(s)
        if err != nil {
            fmt.Printf("%-10q → error: %v\n", s, err)
        } else {
            fmt.Printf("%-10q → %d\n", s, p)
        }
    }
}
```

Output:
```
"8080"     → 8080
"0"        → error: port 0 out of valid range 1-65535
"65536"    → error: port "65536" out of valid range 1-65535
"abc"      → error: port "abc" is not a number
""         → error: port "" is not a number
```

---

## 13. Common Mistakes

### 13.1 Ignoring the error

```go
// BAD — if "count" is missing, n is silently 0
n, _ := strconv.Atoi(r.URL.Query().Get("count"))
items := items[:n] // index out of range or wrong result
```

```go
// GOOD
s := r.URL.Query().Get("count")
n, err := strconv.Atoi(s)
if err != nil {
    http.Error(w, "invalid count: "+s, http.StatusBadRequest)
    return
}
```

### 13.2 Wrong base confusion

```go
// BAD — ParseInt with base 0 treats "010" as octal (= 8, not 10)
n, _ := strconv.ParseInt("010", 0, 64)
fmt.Println(n) // 8

// GOOD — explicit base 10
n, _ = strconv.ParseInt("010", 10, 64)
fmt.Println(n) // 10
```

Always use an explicit base unless you genuinely want Go's prefix
detection.

### 13.3 Wrong bitSize for float

```go
// BAD — s was produced by FormatFloat with bitSize 64,
// but we parse with bitSize 32, losing precision
f, _ := strconv.ParseFloat("1.0000000000000002", 32)
fmt.Printf("%.16f\n", f) // 1.0000000000000000 — precision lost

// GOOD — match the bitSize to your variable type
f, _ = strconv.ParseFloat("1.0000000000000002", 64)
fmt.Printf("%.16f\n", f) // 1.0000000000000002
```

### 13.4 Assuming Atoi handles leading/trailing whitespace

```go
input := " 42\n" // common when reading from bufio.Scanner line
n, err := strconv.Atoi(input)
fmt.Println(err) // strconv.Atoi: parsing " 42\n": invalid syntax

// Fix: trim first
n, err = strconv.Atoi(strings.TrimSpace(input))
fmt.Println(n, err) // 42 <nil>
```

### 13.5 Overflow after ignoring error from ParseInt

```go
// BAD — ignoring error, then casting to int8
v, _ := strconv.ParseInt("200", 10, 64) // err is ErrRange for bitSize 8,
                                         // but we used bitSize 64 so no error
i8 := int8(v) // silent overflow: 200 wraps to -56
fmt.Println(i8) // -56

// GOOD — use the correct bitSize
v, err := strconv.ParseInt("200", 10, 8)
if err != nil {
    fmt.Println(err) // value out of range
}
```

---

## 14. Real-World Analogies

**Post office sorting.** `Parse*` is the postal scanner that reads a
handwritten address and extracts street number, zip code, and city
into typed fields. `Format*` is the label printer that takes those
typed fields and writes them back as a machine-readable address.

**Currency exchange.** `Atoi` is the kiosk for one currency pair.
`ParseInt(s, base, bitSize)` is the bank that handles every currency
and denomination.

---

## 15. Mental Models

```
         Atoi("42")            Itoa(42)
            │                     │
"42" ───────┤ Parse             42 ├─────── "42"
            │                     │
         ParseInt("42", 10, 64)   FormatInt(42, 10)
```

```
Parse* family
┌─────────────────────────────────────────────┐
│ strconv.Atoi(s)              → int           │
│ strconv.ParseInt(s, b, bits) → int64         │
│ strconv.ParseUint(s, b, bits)→ uint64        │
│ strconv.ParseFloat(s, bits)  → float64       │
│ strconv.ParseBool(s)         → bool          │
└─────────────────────────────────────────────┘

Format* family
┌─────────────────────────────────────────────┐
│ strconv.Itoa(n)              → string        │
│ strconv.FormatInt(n, base)   → string        │
│ strconv.FormatUint(n, base)  → string        │
│ strconv.FormatFloat(f,…)     → string        │
│ strconv.FormatBool(b)        → string        │
└─────────────────────────────────────────────┘
```

---

## 16. Code Examples

### Example 1 — Parse an environment variable

```go
package main

import (
    "fmt"
    "os"
    "strconv"
)

func envInt(key string, def int) int {
    s := os.Getenv(key)
    if s == "" {
        return def
    }
    n, err := strconv.Atoi(s)
    if err != nil {
        fmt.Fprintf(os.Stderr, "warning: $%s=%q is not an integer, using %d\n", key, s, def)
        return def
    }
    return n
}

func main() {
    workers := envInt("WORKERS", 4)
    fmt.Println("workers:", workers)
}
```

### Example 2 — Parse hex color

```go
func parseHex(s string) (r, g, b uint8, err error) {
    s = strings.TrimPrefix(s, "#")
    if len(s) != 6 {
        return 0, 0, 0, fmt.Errorf("invalid hex color %q", s)
    }
    rv, err := strconv.ParseUint(s[0:2], 16, 8)
    if err != nil { return }
    gv, err := strconv.ParseUint(s[2:4], 16, 8)
    if err != nil { return }
    bv, err := strconv.ParseUint(s[4:6], 16, 8)
    if err != nil { return }
    return uint8(rv), uint8(gv), uint8(bv), nil
}
```

### Example 3 — Read a CSV row with mixed types

```go
func parseRow(fields []string) (id int, price float64, active bool, err error) {
    id, err = strconv.Atoi(fields[0])
    if err != nil {
        return 0, 0, false, fmt.Errorf("id: %w", err)
    }
    price, err = strconv.ParseFloat(fields[1], 64)
    if err != nil {
        return 0, 0, false, fmt.Errorf("price: %w", err)
    }
    active, err = strconv.ParseBool(fields[2])
    if err != nil {
        return 0, 0, false, fmt.Errorf("active: %w", err)
    }
    return id, price, active, nil
}
```

### Example 4 — Format a metric value

```go
func formatMetric(name string, value float64) string {
    return name + "=" + strconv.FormatFloat(value, 'f', 3, 64)
}

fmt.Println(formatMetric("latency_ms", 4.2398)) // latency_ms=4.240
```

### Example 5 — Format integer in multiple bases

```go
n := 255
fmt.Printf("dec: %s\n", strconv.FormatInt(int64(n), 10))  // dec: 255
fmt.Printf("hex: %s\n", strconv.FormatInt(int64(n), 16))  // hex: ff
fmt.Printf("bin: %s\n", strconv.FormatInt(int64(n), 2))   // bin: 11111111
```

---

## 17. Coding Patterns

```go
// Parse a required int from a map (e.g., config)
func mustInt(m map[string]string, key string) int {
    n, err := strconv.Atoi(m[key])
    if err != nil {
        panic(fmt.Sprintf("config %q: %v", key, err))
    }
    return n
}

// Convert a slice of strings to ints
func parseInts(ss []string) ([]int, error) {
    out := make([]int, 0, len(ss))
    for i, s := range ss {
        n, err := strconv.Atoi(strings.TrimSpace(s))
        if err != nil {
            return nil, fmt.Errorf("element %d: %w", i, err)
        }
        out = append(out, n)
    }
    return out, nil
}
```

---

## 18. Clean Code Guidelines

1. Always check the error returned by `Parse*`.
2. Use the explicit `bitSize` parameter — it documents intent and
   catches overflow.
3. Use an explicit `base` in `ParseInt` unless auto-detection is
   intentional.
4. `strings.TrimSpace` before any `Parse*` when the input comes from
   user text or file lines.
5. Wrap `strconv` errors with `fmt.Errorf("field X: %w", err)` so
   callers know which field failed.
6. Prefer `Atoi`/`Itoa` for the common decimal int case — they signal
   intent more clearly than `ParseInt(s, 10, 0)`.

---

## 19. Error Handling Reference

```go
_, err := strconv.Atoi(s)
if err != nil {
    var numErr *strconv.NumError
    errors.As(err, &numErr)
    // numErr.Func — e.g. "Atoi"
    // numErr.Num  — the input string
    // numErr.Err  — strconv.ErrSyntax or strconv.ErrRange
}
```

---

## 20. Self-Assessment Checklist

- [ ] I know the difference between `Atoi` and `ParseInt`.
- [ ] I always check the error from `Parse*`.
- [ ] I know what `ErrSyntax` and `ErrRange` mean.
- [ ] I use explicit base in `ParseInt` unless auto-detection is wanted.
- [ ] I use matching `bitSize` for `ParseFloat`.
- [ ] I `strings.TrimSpace` before parsing user input.
- [ ] I wrap `strconv` errors with context using `fmt.Errorf`.
- [ ] I know that `Itoa` and `FormatBool` never return an error.

---

## 21. Summary

`strconv` is organized into two symmetric families: `Parse*` functions
convert a string into a typed value and return `(value, error)`;
`Format*` functions convert a typed value into a string and never
fail. The shortcuts `Atoi` and `Itoa` cover the most common case.
Every `Parse*` function can return `ErrSyntax` (invalid characters)
or `ErrRange` (value out of bounds). Always check the error, always
trim whitespace from user input, and always use explicit `base` and
`bitSize` parameters when you care about those details.

---

## 22. Further Reading

- [pkg.go.dev/strconv](https://pkg.go.dev/strconv) — full docs.
- [Go Blog — Strings, bytes, runes, and characters](https://go.dev/blog/strings)
- [Effective Go — Conversions](https://go.dev/doc/effective_go)
