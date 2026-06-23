# Type Conversion in Go — Interview Q&A

---

## Junior Level Questions

**Q1. What is the syntax for type conversion in Go?**

**A:** The syntax is `T(value)` where `T` is the target type and `value` is the expression to convert.

```go
var i int = 42
var f float64 = float64(i)  // int → float64
var u uint = uint(f)        // float64 → uint
```

---

**Q2. Does Go support implicit type conversion?**

**A:** No. Go requires all type conversions to be explicit. Even "safe" conversions like `int8` to `int64` must be written explicitly. This is a deliberate design choice to make code predictable and readable.

```go
var a int8 = 10
var b int64 = a  // COMPILE ERROR: cannot use a (type int8) as type int64
var b2 int64 = int64(a)  // CORRECT
```

---

**Q3. What does `string(65)` produce? Why is this a common bug?**

**A:** It produces `"A"` — the Unicode character with code point 65. This is a common bug because developers expect `"65"` (the decimal string representation), but Go creates the Unicode character.

```go
n := 65
s1 := string(n)          // "A" — Unicode character!
s2 := strconv.Itoa(n)    // "65" — decimal string (correct!)
s3 := fmt.Sprintf("%d", n) // "65" — also correct
```

---

**Q4. Which package should you use to convert an integer to its string representation?**

**A:** The `strconv` package. Specifically `strconv.Itoa(n)` for `int` to string, or `strconv.FormatInt(n, 10)` for `int64`.

```go
import "strconv"

n := 42
s := strconv.Itoa(n)   // "42"
```

---

**Q5. What happens when you convert `float64(3.9)` to `int`?**

**A:** The result is `3` — Go truncates (drops the decimal), it does NOT round. To round, use `math.Round` first.

```go
f := 3.9
i := int(f)                   // 3, not 4!
i2 := int(math.Round(f))      // 4 (correct rounding)
```

---

**Q6. How do you safely extract a string value from an `interface{}`?**

**A:** Use the two-value form of type assertion: `s, ok := i.(string)`. The single-value form panics if the type doesn't match.

```go
var i interface{} = "hello"

// Safe form (preferred)
s, ok := i.(string)
if !ok {
    fmt.Println("not a string")
    return
}
fmt.Println(s)  // "hello"

// Panicking form (only use when you're certain)
s2 := i.(string)  // panics if i is not a string
```

---

**Q7. What is the difference between `[]byte(s)` and `[]rune(s)`?**

**A:**
- `[]byte(s)` converts a string to a slice of bytes. For ASCII, each character is one byte. For multi-byte Unicode characters, one character becomes multiple bytes.
- `[]rune(s)` converts a string to a slice of Unicode code points. Each element is one character, regardless of how many bytes it uses.

```go
s := "Hello 🌍"
bytes := []byte(s)   // len = 10 (emoji takes 4 bytes)
runes := []rune(s)   // len = 7  (each char = 1 rune)
```

---

**Q8. How do you convert a string to an integer?**

**A:** Use `strconv.Atoi` for string to `int`, or `strconv.ParseInt` for more control. Always check the error.

```go
s := "42"
n, err := strconv.Atoi(s)
if err != nil {
    fmt.Println("Error:", err)
    return
}
fmt.Println(n * 2)  // 84
```

---

**Q9. What is integer overflow in the context of type conversion?**

**A:** Overflow occurs when you convert a value to a type that can't hold it. The value wraps around silently — no panic or error occurs.

```go
var big int = 300
var small int8 = int8(big)  // 300 - 256 = 44 (wrapped!)
fmt.Println(small)          // 44, not 300

var negative int = -1
var unsigned uint = uint(negative)  // wraps to max uint value!
```

---

**Q10. Can you convert between `bool` and `int` in Go?**

**A:** No. Go does not allow direct conversion between `bool` and numeric types. You must use explicit logic.

```go
b := true
// n := int(b)  // COMPILE ERROR

// Must use if/else or ternary equivalent
var n int
if b {
    n = 1
}
```

---

## Middle Level Questions

**Q11. What is the difference between a type alias and a type definition in Go, and how does it affect type conversion?**

**A:**
- **Type alias** (`type A = B`): A and B are exactly the same type. No conversion needed.
- **Type definition** (`type A B`): A is a new distinct type. Conversion IS required.

```go
// Alias — same type
type MyString = string
var s string = "hello"
var ms MyString = s  // OK — no conversion

// Definition — new distinct type
type MyString2 string
var s2 string = "hello"
// var ms2 MyString2 = s2  // COMPILE ERROR
var ms2 MyString2 = MyString2(s2)  // requires conversion
```

---

**Q12. Why can't you convert `[]int` to `[]float64` directly in Go?**

**A:** Go only allows conversions between types that satisfy the spec's convertibility rules. Slice types `[]T` and `[]U` are only convertible when `T` and `U` are the same type. Even if `int` converts to `float64`, `[]int` does NOT convert to `[]float64`. You must convert element by element.

```go
ints := []int{1, 2, 3}
// floats := []float64(ints)  // COMPILE ERROR

floats := make([]float64, len(ints))
for i, v := range ints {
    floats[i] = float64(v)
}
```

---

**Q13. How do you convert between two struct types in Go?**

**A:** Two struct types can be converted to each other if they have the same fields (same names, same types, same order) — even if they have different type names. Tags do NOT need to match.

```go
type Point struct{ X, Y int }
type Coordinate struct{ X, Y int }

p := Point{X: 1, Y: 2}
c := Coordinate(p)  // OK — same fields
fmt.Println(c)       // {1 2}

// Tags don't affect convertibility:
type A struct{ F int `json:"f"` }
type B struct{ F int `json:"field"` }
a := A{F: 1}
b := B(a)  // OK!
```

---

**Q14. What is a type switch and when would you use it instead of a type assertion?**

**A:** A type switch branches on the dynamic type of an interface value. Use it when you need to handle multiple possible types, instead of chaining multiple type assertions.

```go
func process(v interface{}) string {
    switch x := v.(type) {
    case string:
        return "string: " + x
    case int:
        return "int: " + strconv.Itoa(x)
    case []byte:
        return "bytes: " + string(x)
    default:
        return fmt.Sprintf("other: %T", x)
    }
}
```

---

**Q15. Explain the `strconv.NumError` type. What information does it contain?**

**A:** `strconv.NumError` is returned when a parse function fails. It contains the function name, the input string, and the underlying error.

```go
_, err := strconv.Atoi("abc")
if e, ok := err.(*strconv.NumError); ok {
    fmt.Println("Func:", e.Func)    // "Atoi"
    fmt.Println("Num:", e.Num)      // "abc"
    fmt.Println("Err:", e.Err)      // strconv.ErrSyntax
}
```

---

**Q16. How does Go handle conversion between named function types?**

**A:** If two function types have identical signatures (same parameter and return types), they can be converted to each other.

```go
type Handler func(string) string
type Transformer func(string) string

func upper(s string) string { return strings.ToUpper(s) }

var h Handler = Handler(upper)        // convert func to Handler
var t Transformer = Transformer(h)   // convert Handler to Transformer
```

---

**Q17. What is the performance difference between `strconv.Itoa` and `fmt.Sprintf("%d", n)`?**

**A:** `strconv.Itoa` is approximately 7x faster than `fmt.Sprintf`. `fmt.Sprintf` uses reflection and has higher overhead. Use `strconv` for simple conversions in performance-sensitive code.

```
strconv.Itoa:   ~30 ns, 1 alloc
fmt.Sprintf:    ~200 ns, 2 allocs
```

---

**Q18. Can you use an untyped constant where a typed variable is expected without conversion?**

**A:** Yes. Untyped constants adapt to their context — they don't have a fixed type until they're given one.

```go
const factor = 2  // untyped integer constant
var f float64 = 3.14 * factor  // OK — factor adapts to float64

// Typed constants require explicit conversion:
const typedFactor int = 2
// var f2 float64 = 3.14 * typedFactor  // COMPILE ERROR
var f2 float64 = 3.14 * float64(typedFactor)  // OK
```

---

**Q19. How do you handle potential integer overflow when parsing user input?**

**A:** Use `strconv.ParseInt` with the appropriate bit size parameter, which validates range automatically.

```go
// Parse as int8 with automatic range validation
n, err := strconv.ParseInt(input, 10, 8)  // bitSize=8 means valid range is -128 to 127
if err != nil {
    return fmt.Errorf("value out of range for int8: %w", err)
}
val := int8(n)  // Safe: ParseInt already validated the range
```

---

**Q20. What happens during JSON unmarshaling when a numeric field is read into `interface{}`?**

**A:** JSON numbers always unmarshal into `float64` when the target is `interface{}`. This requires an explicit type assertion AND conversion to get an integer.

```go
var data map[string]interface{}
json.Unmarshal([]byte(`{"count": 42}`), &data)

// data["count"] is float64(42), NOT int(42)!
count := data["count"].(float64)  // type assertion to float64
intCount := int(count)             // conversion to int
```

---

## Senior Level Questions

**Q21. Explain how `unsafe.Slice` and `unsafe.String` (Go 1.20+) enable zero-copy conversions.**

**A:** `unsafe.Slice(ptr, len)` creates a slice pointing to the same memory as `ptr` without copying. `unsafe.String(ptr, len)` creates a string header pointing to the byte array. Both avoid the allocation that `[]byte(s)` or `string(b)` would cause.

```go
// Zero-copy string → []byte (read-only!)
func toBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
    // CRITICAL: do NOT modify the returned slice
}

// Zero-copy []byte → string
func toString(b []byte) string {
    return unsafe.String(unsafe.SliceData(b), len(b))
    // CRITICAL: do NOT modify b after this
}
```

---

**Q22. Why does `float64(int64(9007199254740993))` not equal `int64(9007199254740993)` after round-trip?**

**A:** `float64` has a 52-bit mantissa (53 bits of precision with the implicit leading 1), so it can exactly represent integers only up to 2^53 = 9007199254740992. The value 9007199254740993 = 2^53 + 1 cannot be exactly represented, so it rounds to 9007199254740992.

```go
var big int64 = 9007199254740993
f := float64(big)          // rounds to 9007199254740992
back := int64(f)           // 9007199254740992, not 9007199254740993!
fmt.Println(big == back)   // false
```

---

**Q23. How does the Go compiler optimize away allocations for `[]byte(s)` in certain patterns?**

**A:** The compiler recognizes specific patterns where the `[]byte` slice does not escape and uses a stack-allocated `tmpBuf` instead of calling `mallocgc`:
1. `for i, b := range []byte(s)` — no allocation
2. `m[string(key)]` for map lookup — no allocation
3. `string(b) == "literal"` — no allocation

The compiler's escape analysis determines whether the converted value could outlive the current stack frame. If not, it uses `tmpBuf`.

---

**Q24. What is the `itab` structure, and how does it relate to interface type assertions?**

**A:** `itab` (interface table) is a runtime structure that stores a pair: (interface type, concrete type) plus a method pointer table. When a type assertion `i.(T)` is performed:
1. The interface's `itab` pointer is loaded
2. Its `_type` field is compared (pointer equality) against the descriptor for `T`
3. If equal, the data pointer is returned; if not, either a panic occurs or `ok=false` is returned

This is O(1) — a single pointer comparison.

---

**Q25. In a high-throughput system processing 100,000 requests/second, each requiring string-to-int parsing, what techniques would you use to minimize GC pressure from conversions?**

**A:** Multiple techniques:

1. **`strconv.ParseInt` instead of `Atoi`** — same cost but directly gives int64
2. **Pre-validation to avoid strconv for known patterns** — if all IDs are 1-7 digits, fast-path them
3. **`sync.Pool` for request objects** — avoid allocating new structs per request
4. **`strconv.AppendInt` for int-to-string** — writes to pre-allocated buffer
5. **`strings.Builder` with `Reset()`** — reuse builder across requests
6. **Profile first** — use `go tool pprof` with heap profile to find actual hotspots

```go
var bufPool = sync.Pool{New: func() interface{} { return new([32]byte) }}

func parseIDFast(s string) (int64, error) {
    // Fast path: avoid strconv for common short IDs
    if len(s) <= 7 && len(s) > 0 {
        var n int64
        for _, c := range s {
            if c < '0' || c > '9' {
                return 0, errors.New("invalid")
            }
            n = n*10 + int64(c-'0')
        }
        return n, nil
    }
    return strconv.ParseInt(s, 10, 64)
}
```

---

**Q26. Explain the difference between `i.(type)` in a type switch and `reflect.TypeOf(i)`.**

**A:**
- `i.(type)` in a type switch is a compile-time construct that generates efficient conditional jumps based on runtime type information stored in the interface's type pointer
- `reflect.TypeOf(i)` uses the full reflection system — it accesses the `_type` structure and wraps it in a `reflect.Type` interface value

`i.(type)` is typically 2-5x faster than `reflect.TypeOf` because it avoids the reflect overhead. Use type switches when the set of types is known at compile time; use reflection when you need to inspect unknown types dynamically.

---

**Q27. What is the correct way to convert between pointer types in Go?**

**A:** Direct pointer conversion between unrelated types is not allowed. To convert between pointer types, you must use `unsafe.Pointer` as an intermediary, following Go's strict unsafe pointer rules:

```go
// Rule: conversion must be atomic expression
var f float64 = 3.14
bits := *(*uint64)(unsafe.Pointer(&f))  // reinterpret float64 bits as uint64
// This is valid — equivalent to math.Float64bits(f)

// WRONG: storing uintptr and converting back later
ptr := uintptr(unsafe.Pointer(&f))
// ... anything here can invalidate ptr (GC may move the object)
// *(*uint64)(unsafe.Pointer(ptr))  // INVALID — ptr may be stale
```

---

**Q28. How do generics in Go 1.18+ interact with type conversion?**

**A:** Generic functions can perform conversions using type parameters constrained by `~T` (underlying type constraints). The `constraints` package provides `Integer`, `Float`, `Ordered`, etc.

```go
import "golang.org/x/exp/constraints"

func Sum[T constraints.Integer | constraints.Float](s []T) T {
    var total T
    for _, v := range s {
        total += v
    }
    return total
}

// Type conversion in generic code:
func ToFloat64[T constraints.Integer](v T) float64 {
    return float64(v)  // Works for any T in the constraint!
}
```

---

**Q29. What is the behavior of converting negative float to unsigned integer?**

**A:** The behavior is implementation-defined for values outside the target range. On x86-64, `uint(float64(-1.0))` truncates the float to `int` first (giving -1), then converts to `uint` (giving `^uint(0)`). This is a common source of bugs.

```go
f := -1.0
u := uint(f)   // On amd64: very large number (wrap)
fmt.Println(u) // 18446744073709551615

// Safe pattern:
if f < 0 {
    return errors.New("cannot convert negative float to uint")
}
u2 := uint(f)
```

---

**Q30. Describe a real production incident caused by a type conversion bug and how you would prevent it.**

**A:** Classic incident: Using `int32` for Unix timestamps. The `int32` timestamp overflows on January 19, 2038 (the "Y2K38" problem). Many embedded systems and databases using 32-bit timestamps will fail.

Prevention:
```go
// BAD: int32 timestamps overflow in 2038
type Timestamp int32

// GOOD: int64 timestamps work until year 292,277,026,596
type Timestamp int64

// When converting from external sources:
func ParseTimestamp(s string) (Timestamp, error) {
    n, err := strconv.ParseInt(s, 10, 64)
    if err != nil {
        return 0, err
    }
    // Additional validation: reject clearly invalid timestamps
    if n < 0 || n > 32503680000 {  // year 3000 max
        return 0, fmt.Errorf("timestamp out of reasonable range: %d", n)
    }
    return Timestamp(n), nil
}
```

---

## Scenario-Based Questions

**Q31. You're reviewing code and find `userID := int(someFloat64)`. What questions do you ask?**

**A:**
1. Where does `someFloat64` come from? (JSON? User input? Calculation?)
2. Could it ever be negative? (JSON numbers can't be negative IDs)
3. Could it exceed `int` range? (On 32-bit systems, `int` is 32 bits)
4. Is precision loss acceptable? (`float64` can't exactly represent all `int64` values)
5. Should this be `int64` instead of `int`?

Better pattern:
```go
if someFloat64 < 0 || someFloat64 > math.MaxInt64 {
    return fmt.Errorf("invalid user ID: %f", someFloat64)
}
userID := int64(someFloat64)
// Verify no precision loss:
if float64(userID) != someFloat64 {
    return fmt.Errorf("precision loss converting %f to int64", someFloat64)
}
```

---

**Q32. A colleague says: "I'll just use `fmt.Sprintf` everywhere for type conversion — it's simpler." How do you respond?**

**A:** For correctness, `fmt.Sprintf` is fine. But for performance-sensitive code (high-throughput APIs, hot loops), `fmt.Sprintf` is ~7x slower than `strconv`. The main points:
- Use `strconv` for simple conversions in hot paths
- Use `fmt.Sprintf` for complex formatting or rarely-called code
- Use `strconv.Append*` functions for zero-allocation conversion when you already have a buffer
- Profile before optimizing — if conversion isn't a bottleneck, simplicity wins

---

**Q33. You see `[]byte(myString)` called 10,000 times per second in your profiler. What's your approach?**

**A:**
1. **Identify why** — is this for comparison, modification, or passing to a function?
2. **For comparison only** — use `bytes.Equal([]byte(a), []byte(b))` → change to `a == b` (string comparison)
3. **For read-only processing** — use `unsafe.Slice(unsafe.StringData(s), len(s))` (zero-copy)
4. **For modification** — keep the conversion, but ensure the buffer is pooled via `sync.Pool`
5. **Re-evaluate the design** — if you're converting constantly, should the data be `[]byte` from the start?

---

**Q34. How would you design a configuration loader that safely parses environment variables into typed values?**

**A:**
```go
type Config struct {
    Port     int
    Timeout  time.Duration
    MaxConns int
    Debug    bool
}

type loader struct {
    errors []error
}

func (l *loader) intVar(name string, defaultVal int) int {
    s := os.Getenv(name)
    if s == "" {
        return defaultVal
    }
    n, err := strconv.Atoi(s)
    if err != nil {
        l.errors = append(l.errors, fmt.Errorf("env %s=%q: %w", name, s, err))
        return defaultVal
    }
    return n
}

func LoadConfig() (*Config, error) {
    l := &loader{}
    cfg := &Config{
        Port:     l.intVar("PORT", 8080),
        MaxConns: l.intVar("MAX_CONNS", 100),
    }
    if len(l.errors) > 0 {
        return nil, errors.Join(l.errors...)
    }
    return cfg, nil
}
```

---

## FAQ

**FAQ1. When should I use `int` vs `int64` when converting from other types?**

Use `int64` for:
- Timestamps, IDs, counters that might exceed 2^31
- Any value coming from external systems (databases, APIs)
- Financial values (in cents)

Use `int` for:
- Array indices, lengths (matches `len()` return type)
- Loop counters
- Values that are provably small

**FAQ2. Is it ever safe to use the single-value type assertion `i.(T)` (without ok)?**

Yes, when you've already verified the type, typically right after a type switch's `default` case or when a function's contract guarantees the type. But in library code or public APIs, always prefer the two-value form.

**FAQ3. What's the difference between `int(f)` and `int64(f)` when `f` is `float64`?**

On 64-bit systems, `int` is 64 bits, so they're equivalent. On 32-bit systems, `int` is 32 bits and would overflow for large values. For portability, use `int64` explicitly.

**FAQ4. Can type assertions be used with nil interfaces?**

A nil interface has no type, so any type assertion on it will fail (return `ok=false` or panic). Check for nil before asserting.

```go
var i interface{} = nil
s, ok := i.(string)
fmt.Println(ok)  // false
fmt.Println(s)   // "" (zero value)
```

**FAQ5. Does Go's `any` (alias for `interface{}`) behave differently for type assertions?**

No. `any` is exactly `interface{}` — it's just a shorter alias introduced in Go 1.18. All type assertion rules are identical.
