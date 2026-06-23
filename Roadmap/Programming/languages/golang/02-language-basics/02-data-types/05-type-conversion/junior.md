# Type Conversion in Go — Junior Level

## 1. Introduction

**What is Type Conversion?**

Type conversion in Go is the process of explicitly changing a value from one type to another. Unlike many other languages, Go does **not** perform implicit (automatic) type conversion. Every conversion must be written by the programmer — Go forces you to be explicit about what you want.

**Syntax:**
```go
T(value)
```
Where `T` is the target type and `value` is the value you want to convert.

**How to use it:**
```go
var i int = 42
var f float64 = float64(i)  // explicit conversion: int → float64
```

---

## 2. Prerequisites

Before learning type conversion, you should understand:
- Basic Go variable declarations (`var`, `:=`)
- Primitive data types: `int`, `float64`, `string`, `bool`, `byte`, `rune`
- The concept of static typing
- Basic Go program structure (`package main`, `import`, `func main`)

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Type Conversion** | Explicitly changing a value from one type to another |
| **Implicit conversion** | Automatic conversion done by the language (Go does NOT have this) |
| **Explicit conversion** | Conversion written by the programmer using `T(value)` syntax |
| **Narrowing conversion** | Converting to a smaller type (may lose data) |
| **Widening conversion** | Converting to a larger type (generally safe) |
| **Truncation** | Dropping decimal or extra bits when converting |
| **Overflow** | When a value is too large for the target type |
| **strconv** | Standard library package for string conversions |
| **rune** | An alias for `int32`, represents a Unicode code point |
| **byte** | An alias for `uint8`, represents a single ASCII character |
| **Type assertion** | Extracting a concrete type from an interface |

---

## 4. Core Concepts

### 4.1 No Implicit Conversion

In Go, unlike Python, JavaScript, or C, you cannot mix types without conversion:

```go
var i int = 10
var f float64 = 3.14

// COMPILE ERROR — cannot use i (type int) as type float64
// result := f + i

// CORRECT — explicit conversion
result := f + float64(i)  // 13.14
```

### 4.2 The T(value) Syntax

Every conversion uses the same pattern:

```go
targetType(value)

// Examples:
float64(42)          // int → float64
int(3.99)            // float64 → int (truncates, becomes 3)
string(65)           // int → string (becomes "A" — the Unicode character!)
[]byte("hello")      // string → byte slice
```

### 4.3 Numeric Conversions

```go
var i int = 100
var i8 int8 = int8(i)     // int → int8
var i16 int16 = int16(i)  // int → int16
var i32 int32 = int32(i)  // int → int32
var i64 int64 = int64(i)  // int → int64

var f32 float32 = float32(i)  // int → float32
var f64 float64 = float64(i)  // int → float64

var u uint = uint(i)      // int → uint
```

### 4.4 String Conversions via strconv

Converting between strings and numbers requires the `strconv` package:

```go
import "strconv"

// int to string
s := strconv.Itoa(42)          // "42"

// string to int
n, err := strconv.Atoi("42")  // 42, nil

// float to string
s := strconv.FormatFloat(3.14, 'f', 2, 64)  // "3.14"

// string to float
f, err := strconv.ParseFloat("3.14", 64)    // 3.14, nil
```

### 4.5 String ↔ []byte and []rune

```go
s := "hello"
b := []byte(s)   // string → []byte: [104 101 108 108 111]
s2 := string(b)  // []byte → string: "hello"

r := []rune(s)   // string → []rune (Unicode-safe)
s3 := string(r)  // []rune → string: "hello"
```

---

## 5. Real-World Analogies

**Currency Exchange:**
Type conversion is like exchanging currency. If you have 100 dollars and want euros, you must explicitly perform the exchange — the bank doesn't automatically assume you want euros just because you handed them dollars. And just like currency exchange, sometimes you lose a little in the process (decimal truncation = rounding).

**Measuring Cup Conversion:**
Converting `float64` to `int` is like measuring 3.7 cups of water — when you convert to a whole number measurement, you get 3 cups. You intentionally lose the 0.7.

**Container Pouring:**
Narrowing conversion (e.g., `int` to `int8`) is like pouring a large bucket into a small cup. Some water overflows — that's integer overflow.

---

## 6. Mental Models

**Model 1: "Tell the compiler what you mean"**
Go requires you to state your intentions explicitly. When you write `float64(i)`, you're telling the compiler: "I know `i` is an `int`, and I intentionally want a `float64` version of it."

**Model 2: "Type labels on boxes"**
Each variable is a box with a type label. To put something in a differently-labeled box, you must run it through a conversion machine first.

**Model 3: "Information may be lost on the way"**
Wide-to-narrow conversions (e.g., `float64` → `int`, `int64` → `int8`) always risk losing information. Narrow-to-wide (e.g., `int8` → `int64`) is generally safe.

---

## 7. Pros and Cons

### Pros of Go's Explicit Type Conversion
- **Safety:** No accidental data loss — you must acknowledge it
- **Readability:** Code clearly shows where types change
- **Predictability:** No hidden conversions that surprise you
- **Bug prevention:** Many C/Java bugs caused by implicit conversion don't exist in Go

### Cons
- **Verbosity:** More code to write when doing many conversions
- **Easy to misuse:** `string(65)` compiles fine but gives "A", not "65"
- **Boilerplate:** Working with strconv can feel tedious

---

## 8. Use Cases

| Use Case | Conversion Used |
|----------|----------------|
| Doing math with mixed number types | `float64(i)` |
| Displaying a number as text | `strconv.Itoa(n)` |
| Parsing user input from a text field | `strconv.Atoi(s)` |
| Processing strings byte-by-byte | `[]byte(s)` |
| Working with Unicode text | `[]rune(s)` |
| Reading bytes from network into string | `string(buf[:n])` |
| Extracting concrete type from interface | `i.(string)` |

---

## 9. Code Examples

### Example 1: Basic Numeric Conversion
```go
package main

import "fmt"

func main() {
    var celsius float64 = 36.6
    var celsiusInt int = int(celsius)  // truncates: 36

    fmt.Printf("Temperature: %.1f°C\n", celsius)
    fmt.Printf("As integer: %d°C\n", celsiusInt)

    // Converting in the other direction
    var age int = 25
    var ageFloat float64 = float64(age)
    fmt.Printf("Age as float: %.1f\n", ageFloat)
}
```
**Output:**
```
Temperature: 36.6°C
As integer: 36°C
Age as float: 25.0
```

### Example 2: String Conversions with strconv
```go
package main

import (
    "fmt"
    "strconv"
)

func main() {
    // Number to string
    score := 95
    scoreStr := strconv.Itoa(score)
    fmt.Println("Score: " + scoreStr)  // "Score: 95"

    // String to number
    input := "42"
    num, err := strconv.Atoi(input)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Println("Doubled:", num*2)  // 84

    // The WRONG way — string(65) gives "A", not "65"!
    wrong := string(65)
    fmt.Println("Wrong:", wrong)  // "A"
}
```
**Output:**
```
Score: 95
Doubled: 84
Wrong: A
```

### Example 3: Byte Slice and String
```go
package main

import "fmt"

func main() {
    greeting := "Hello, Go!"

    // Convert to bytes for manipulation
    bytes := []byte(greeting)
    bytes[0] = 'h'  // lowercase first letter
    modified := string(bytes)

    fmt.Println("Original:", greeting)
    fmt.Println("Modified:", modified)

    // Unicode example
    emoji := "Hello 🌍"
    runes := []rune(emoji)
    fmt.Printf("Byte length: %d\n", len([]byte(emoji)))  // 10
    fmt.Printf("Rune length: %d\n", len(runes))          // 7
}
```
**Output:**
```
Original: Hello, Go!
Modified: hello, Go!
Byte length: 10
Rune length: 7
```

### Example 4: Type Assertion
```go
package main

import "fmt"

func printType(i interface{}) {
    // Safe type assertion
    if s, ok := i.(string); ok {
        fmt.Printf("String: %q\n", s)
        return
    }
    if n, ok := i.(int); ok {
        fmt.Printf("Integer: %d\n", n)
        return
    }
    fmt.Printf("Unknown type: %T\n", i)
}

func main() {
    printType("hello")
    printType(42)
    printType(3.14)
}
```
**Output:**
```
String: "hello"
Integer: 42
Unknown type: float64
```

---

## 10. Coding Patterns

### Pattern 1: Safe String to Int with Default
```go
func toIntOrDefault(s string, defaultVal int) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        return defaultVal
    }
    return n
}
```

### Pattern 2: Checked Narrowing Conversion
```go
func safeInt8(n int) (int8, bool) {
    if n < -128 || n > 127 {
        return 0, false
    }
    return int8(n), true
}
```

### Pattern 3: String-to-Number Helper
```go
func mustAtoi(s string) int {
    n, err := strconv.Atoi(s)
    if err != nil {
        panic(fmt.Sprintf("cannot convert %q to int: %v", s, err))
    }
    return n
}
```

---

## 11. Clean Code Guidelines

- Always check errors from `strconv.Atoi`, `strconv.ParseFloat`, etc.
- Name variables clearly when converting: `ageFloat := float64(age)` not `x := float64(y)`
- Avoid `string(intValue)` — this creates a Unicode character, not a digit string
- Prefer `strconv` over `fmt.Sprintf` for simple conversions (it's more explicit and faster)
- Add comments when a conversion may cause data loss

```go
// BAD
x := string(n)          // What does this do? Creates Unicode char from n!
y := int(f)             // Silently drops decimal

// GOOD
x := strconv.Itoa(n)    // Clear: int → numeric string "42"
y := int(f)             // Intentionally truncate float to int (drops decimal)
```

---

## 12. Product Use / Feature Context

Type conversion is everywhere in production Go code:

- **Web servers:** Converting URL parameter strings to integers (`strconv.Atoi`)
- **JSON handling:** Converting between `float64` (JSON default) and `int`
- **Database drivers:** Scanning database values into Go types
- **Config parsers:** Reading environment variables (always strings) and converting
- **Network protocols:** Converting byte buffers to strings and back

```go
// Real-world: reading a port from environment variable
portStr := os.Getenv("PORT")
if portStr == "" {
    portStr = "8080"
}
port, err := strconv.Atoi(portStr)
if err != nil {
    log.Fatalf("Invalid PORT value: %v", err)
}
```

---

## 13. Error Handling

```go
// strconv functions return errors for invalid input
n, err := strconv.Atoi("abc")
if err != nil {
    // err is a *strconv.NumError
    fmt.Println("Parse error:", err)
    // Output: strconv Atoi: parsing "abc": invalid syntax
}

// ParseFloat and ParseInt also return errors
f, err := strconv.ParseFloat("not-a-float", 64)
if err != nil {
    fmt.Println("Parse error:", err)
}

// Type assertions can panic — use the ok form
var i interface{} = 42
s, ok := i.(string)
if !ok {
    fmt.Println("Not a string!")
}
// s is "" (zero value), ok is false — no panic
```

---

## 14. Security Considerations

- **Integer overflow:** Converting user-supplied strings to small integers without range checking can cause silent overflow
- **String injection:** Converting arbitrary bytes to strings can include null bytes or control characters
- **Validate before converting:** Always validate input range before narrowing numeric conversions

```go
// Vulnerable: no range check
func setAge(s string) int8 {
    n, _ := strconv.Atoi(s)
    return int8(n)  // If n=200, int8 wraps to -56!
}

// Safe: check range
func setAgeSafe(s string) (int8, error) {
    n, err := strconv.Atoi(s)
    if err != nil {
        return 0, err
    }
    if n < 0 || n > 150 {
        return 0, fmt.Errorf("age out of range: %d", n)
    }
    return int8(n), nil
}
```

---

## 15. Performance Tips

- `strconv.Itoa` is faster than `fmt.Sprintf("%d", n)` — prefer it for simple int-to-string
- `[]byte(s)` and `string(b)` both allocate memory — avoid in hot loops
- For read-only byte inspection, you can avoid allocation using `unsafe` (advanced topic)
- Converting small integers to float is cheap (single CPU instruction)

---

## 16. Metrics & Analytics

When measuring performance related to conversions:
- Use `go test -bench` to benchmark conversion operations
- Track allocation count with `go test -benchmem`
- Common hotspot: repeated `string ↔ []byte` in request handlers

```go
// Benchmark example
func BenchmarkConversion(b *testing.B) {
    s := "12345"
    for i := 0; i < b.N; i++ {
        _, _ = strconv.Atoi(s)
    }
}
```

---

## 17. Best Practices

1. Always use `strconv` for string ↔ number conversions
2. Never use `string(intValue)` to convert a number to its string representation
3. Always check errors from parsing functions
4. When doing narrowing conversions, comment the reason
5. Use the two-value form of type assertions: `val, ok := i.(Type)`
6. Prefer named types for conversion clarity in APIs

---

## 18. Edge Cases and Pitfalls

```go
// Pitfall 1: Negative int to uint
n := -1
u := uint(n)  // u = 18446744073709551615 (wraps to max uint64!)

// Pitfall 2: Float to int truncates (does not round)
f := 3.9
i := int(f)   // i = 3, not 4!

// Pitfall 3: Large int to float64 loses precision
var big int64 = 9007199254740993
f64 := float64(big)
back := int64(f64)
fmt.Println(back == big)  // false! float64 has only 53-bit mantissa

// Pitfall 4: string(65) is "A" not "65"
n := 65
s := string(n)  // "A" ← Unicode character, not "65"
```

---

## 19. Common Mistakes

| Mistake | Problem | Fix |
|---------|---------|-----|
| `string(65)` | Produces "A" not "65" | Use `strconv.Itoa(65)` |
| Ignoring `strconv.Atoi` error | Silent failure on bad input | Always check `err` |
| `int(3.9)` expecting 4 | Go truncates, doesn't round | Use `math.Round(3.9)` first |
| `int8(300)` expecting 300 | Overflow! Result is 44 | Check range before converting |
| `uint(-1)` | Wraps to max uint | Check for negative before converting |

---

## 20. Common Misconceptions

**Misconception 1:** "Type conversion in Go is the same as type casting in Java/C"
- Reality: In Go, conversions create a new value. In C, casts can be unsafe reinterpretations of memory.

**Misconception 2:** "string(byteSlice) modifies the original"
- Reality: Both `[]byte(string)` and `string([]byte)` create copies.

**Misconception 3:** "Converting float64 to int rounds correctly"
- Reality: Go truncates (drops the decimal). `int(3.9)` is `3`, not `4`.

**Misconception 4:** "You can convert any two types"
- Reality: Only compatible types can be converted. You cannot convert a `bool` to `int` directly in Go.

---

## 21. Tricky Points

```go
// Tricky 1: Type alias vs distinct type
type Celsius float64
type Fahrenheit float64

var c Celsius = 100
// var f Fahrenheit = c  // COMPILE ERROR — different types even though both float64
var f Fahrenheit = Fahrenheit(c)  // OK

// Tricky 2: Untyped constants work without conversion
const factor = 2
var x float64 = 3.14 * factor  // OK! Untyped constant adapts

// Tricky 3: Named type to underlying type
type MyInt int
var m MyInt = 5
var n int = int(m)  // Must explicitly convert

// Tricky 4: rune is int32 — but string(rune) gives character, not digit
var r rune = 65
fmt.Println(string(r))  // "A" — Unicode char for code point 65
```

---

## 22. Test (Quiz)

**Q1.** What does `string(72)` produce?
- a) "72"
- b) "H"
- c) compile error
- d) runtime panic

**Answer:** b) "H" (Unicode code point 72 is 'H')

**Q2.** What is the result of `int(3.7)`?
- a) 4
- b) 3
- c) 3.7
- d) compile error

**Answer:** b) 3 (truncation, not rounding)

**Q3.** Which package should you use to convert an int to its decimal string representation?
- a) `strings`
- b) `fmt`
- c) `strconv`
- d) `unicode`

**Answer:** c) `strconv` (though fmt.Sprintf works too, strconv is more idiomatic)

**Q4.** What happens when you do `int8(200)`?
- a) Returns 200
- b) Returns -56 (overflow)
- c) Compile error
- d) Runtime panic

**Answer:** b) -56 (200 - 256 = -56, wraps around)

**Q5.** Which is the correct way to safely extract a string from an interface{}?
- a) `s := i.(string)`
- b) `s, ok := i.(string)`
- c) `s := string(i)`
- d) `s := i.string()`

**Answer:** b) `s, ok := i.(string)` (the two-value form doesn't panic)

---

## 23. Tricky Questions

**Q: Why doesn't Go allow implicit conversions if they're clearly safe (e.g., int8 to int64)?**

Go's designers chose explicitness over convenience. Even "safe" widening conversions are explicit so code reviewers can immediately see where type boundaries are crossed, making the code more predictable and easier to audit.

**Q: Can you convert between `[]byte` and `string` without allocating memory?**

In standard Go, no — both conversions always copy. However, the compiler sometimes optimizes away the copy in specific patterns (like in `for range` loops over a string converted to `[]byte`).

**Q: What's the difference between a type assertion and a type conversion?**

- Type **conversion** (`T(v)`): Changes a value from one concrete type to another compatible type
- Type **assertion** (`v.(T)`): Extracts a concrete type from an interface value

---

## 24. Cheat Sheet

```go
// NUMERIC CONVERSIONS
int(3.14)              // float64 → int = 3 (truncates)
float64(42)            // int → float64 = 42.0
int64(myInt32)         // int32 → int64
int8(200)              // DANGER: overflow → -56

// STRING ↔ NUMBER (use strconv!)
strconv.Itoa(42)       // int → "42"
strconv.Atoi("42")     // "42" → 42, err
strconv.FormatFloat(3.14, 'f', 2, 64)   // float64 → "3.14"
strconv.ParseFloat("3.14", 64)          // "3.14" → 3.14, err
strconv.FormatBool(true)                // bool → "true"
strconv.ParseBool("true")               // "true" → true, err

// STRING ↔ BYTES / RUNES
[]byte("hello")        // string → byte slice
string([]byte{72,105}) // byte slice → string "Hi"
[]rune("hello")        // string → rune slice (Unicode-safe)
string([]rune{72,105}) // rune slice → string

// COMMON TRAP: string(65) = "A", not "65"!

// TYPE ASSERTION (interfaces)
val, ok := i.(string)  // safe — ok is false if not string
val := i.(string)      // panics if not string
```

---

## 25. Self-Assessment Checklist

- [ ] I can explain why Go requires explicit type conversion
- [ ] I know that `string(65)` gives "A", not "65"
- [ ] I use `strconv.Itoa` and `strconv.Atoi` for number-string conversions
- [ ] I always check errors from `strconv.Parse*` and `strconv.Atoi`
- [ ] I understand that `float64 → int` truncates (does not round)
- [ ] I know that narrowing conversions can overflow
- [ ] I use the `val, ok` form of type assertions
- [ ] I understand `[]byte(s)` creates a copy of the string
- [ ] I can explain the difference between `[]byte` and `[]rune`

---

## 26. Summary

Go requires all type conversions to be explicit using the `T(value)` syntax. This design prevents bugs caused by accidental type coercion. Key points:
- Numeric conversions: use `T(value)`, be aware of truncation and overflow
- Number ↔ string: use the `strconv` package
- String ↔ bytes: `[]byte(s)` and `string(b)` — both copy memory
- `string(intValue)` creates a Unicode character, NOT a decimal string
- Interface extraction uses type assertions with the safe `val, ok` pattern

---

## 27. What You Can Build

After mastering type conversion, you can:
- Write a temperature converter (Celsius, Fahrenheit, Kelvin) with type safety
- Build a command-line calculator that parses string inputs to numbers
- Create a CSV parser that converts string columns to proper Go types
- Implement a config reader that parses environment variables safely
- Write a Unicode text processor using rune conversions

---

## 28. Further Reading

- Go spec: [Type conversions](https://go.dev/ref/spec#Conversions)
- `strconv` package: [pkg.go.dev/strconv](https://pkg.go.dev/strconv)
- Go blog: [The Go Programming Language Specification](https://go.dev/ref/spec)
- Effective Go: [Type conversions section](https://go.dev/doc/effective_go)

---

## 29. Related Topics

- **Data Types:** Understanding the underlying types makes conversions clearer
- **Interfaces:** Type assertions are how you extract values from interfaces
- **fmt package:** `fmt.Sprintf` as an alternative (but slower) conversion method
- **unsafe package:** Low-level pointer conversions (advanced)
- **Named Types:** How type aliases affect conversion requirements

---

## 30. Diagrams and Visual Aids

### Numeric Type Size Hierarchy
```
Narrower ←————————————————————————→ Wider
int8  →  int16  →  int32  →  int64
(8-bit)  (16-bit)  (32-bit)  (64-bit)

Going LEFT (narrowing): DANGER of overflow/truncation
Going RIGHT (widening): safe, but still must be explicit in Go

float32  →  float64
(32-bit)    (64-bit)
```

### String Conversion Decision Tree
```
Need to convert a number to string?
         │
         ▼
  Do you want the numeric digits?
  (e.g., 42 → "42")
         │
    Yes ─┤─ No
         │      │
         ▼      ▼
   strconv    string(n) gives
   .Itoa(n)   Unicode character
              (e.g., 65 → "A")
```

### Memory Model: []byte ↔ string
```
Original string "hello":
┌─────────────────────────────┐
│  h  │  e  │  l  │  l  │  o │  ← original memory
└─────────────────────────────┘

[]byte("hello") → NEW copy:
┌─────────────────────────────┐
│  h  │  e  │  l  │  l  │  o │  ← new memory allocation
└─────────────────────────────┘

string(bytes) → ANOTHER new copy:
┌─────────────────────────────┐
│  h  │  e  │  l  │  l  │  o │  ← yet another allocation
└─────────────────────────────┘
```
