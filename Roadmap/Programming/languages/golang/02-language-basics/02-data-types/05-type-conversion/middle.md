# Type Conversion in Go — Middle Level

## Focus: Why and When to Use Type Conversion

---

## 1. Introduction

At the middle level, type conversion is not just about syntax — it's about understanding *when* conversions are necessary, *why* Go forces them, and *what tradeoffs* exist. This level explores the design rationale, patterns in real codebases, and subtle behaviors that trip up experienced developers.

---

## 2. Prerequisites

- Solid understanding of Go's type system (named types, interfaces, type aliases)
- Familiarity with `strconv`, `fmt`, and `reflect` packages
- Experience with structs, slices, maps, and interfaces
- Understanding of memory allocation in Go

---

## 3. Glossary

| Term | Definition |
|------|-----------|
| **Named type** | A type with a distinct name, even if it has the same underlying type as another |
| **Underlying type** | The base type a named type is built from |
| **Type identity** | Two types are identical only if they have the same name and origin |
| **Type alias** | `type A = B` — A and B are exactly the same type |
| **Type definition** | `type A B` — A is a new distinct type with underlying type B |
| **Assignability** | Rules for when a value of one type can be assigned to a variable of another |
| **Type switch** | A switch statement that branches on the dynamic type of an interface |
| **reflect.Type** | Runtime type information accessible through reflection |
| **NumError** | The error type returned by `strconv` parse functions |
| **Interface satisfaction** | A concrete type implements an interface if it has all the required methods |

---

## 4. Core Concepts (Why and When)

### 4.1 Why Go Has No Implicit Conversion

Go's designers made a deliberate choice. In C, implicit conversions cause silent bugs:

```c
// C code — silent bug
int x = 5;
double y = 5.3;
double z = x + y;  // x implicitly promoted to double — fine
int result = z;    // z implicitly truncated — 10.3 becomes 10, silent!
```

In Go, every type boundary crossing is visible:

```go
// Go — explicit and readable
var x int = 5
var y float64 = 5.3
var z float64 = float64(x) + y    // explicit promotion
var result int = int(z)            // explicit truncation — reader knows!
```

**Why this matters:** In a code review or bug hunt, every type boundary is visible. No surprises.

### 4.2 When Conversion Is Required vs. Not Required

**Required:**
```go
var a int = 10
var b float64 = a  // COMPILE ERROR — even though "obviously safe"
```

**Not Required (assignability rules):**
```go
// Untyped constant — adapts to context
const pi = 3.14159
var f64 float64 = pi  // OK — pi is untyped, adapts
var f32 float32 = pi  // OK — same reason

// Interface assignment
var r io.Reader = os.Stdin  // OK — *os.File implements io.Reader
```

### 4.3 Named Types and Conversion

This is where middle-level developers often get confused:

```go
type Meters float64
type Kilograms float64

var distance Meters = 100.0
var weight Kilograms = Kilograms(100.0)

// You CANNOT add different named types even with same underlying type:
// total := distance + weight  // COMPILE ERROR — type safety!

// You CAN convert between named types with same underlying type:
var plain float64 = float64(distance)  // Meters → float64
var dist2 Meters = Meters(plain)       // float64 → Meters
```

This feature is powerful for domain modeling — it prevents mixing up meters with kilograms even though both are `float64`.

### 4.4 Type Aliases vs. Type Definitions

```go
// Type ALIAS — same type, no conversion needed
type MyString = string
var s string = "hello"
var ms MyString = s  // OK — they're the same type

// Type DEFINITION — new type, conversion needed
type MyString2 string
var s2 string = "hello"
// var ms2 MyString2 = s2  // COMPILE ERROR
var ms2 MyString2 = MyString2(s2)  // Must convert
```

---

## 5. Evolution and Historical Context

Before Go 1.0, the spec went through several revisions regarding conversions. Key historical points:

- **Pre-1.0:** Some implicit conversions existed for constants
- **Go 1.0:** Strict explicit conversion rules formalized
- **Go 1.18:** Generics introduced type parameters, which interact with conversions via constraints
- **Go 1.21+:** `min`, `max`, `clear` builtins reduce some conversion needs in comparisons

The strict conversion rule has never been relaxed — it's a core Go philosophy.

---

## 6. Alternative Approaches

### Approach 1: strconv vs fmt.Sprintf

```go
n := 42

// Option A: strconv.Itoa — fastest, most idiomatic for int→string
s1 := strconv.Itoa(n)

// Option B: fmt.Sprintf — slower, but flexible for complex formatting
s2 := fmt.Sprintf("%d", n)

// Option C: fmt.Sprint — even less efficient
s3 := fmt.Sprint(n)

// Benchmark results (approximate):
// strconv.Itoa: ~30ns
// fmt.Sprintf:  ~200ns (7x slower)
```

### Approach 2: Direct []byte vs strings.Builder

```go
// When building strings from mixed types:
// Option A: Multiple conversions
result := strconv.Itoa(x) + " " + strconv.FormatFloat(y, 'f', 2, 64)

// Option B: strings.Builder (avoids intermediate allocations)
var b strings.Builder
fmt.Fprintf(&b, "%d %.2f", x, y)
result := b.String()
```

### Approach 3: Type Assertion vs Type Switch

```go
// Type assertion — good for known specific type
func processString(v interface{}) string {
    s, ok := v.(string)
    if !ok {
        return ""
    }
    return s
}

// Type switch — better when handling multiple types
func describe(v interface{}) string {
    switch val := v.(type) {
    case string:
        return "string: " + val
    case int:
        return "int: " + strconv.Itoa(val)
    case float64:
        return fmt.Sprintf("float: %.2f", val)
    default:
        return fmt.Sprintf("unknown: %T", val)
    }
}
```

---

## 7. Anti-Patterns

### Anti-Pattern 1: Ignoring strconv Errors

```go
// BAD — silently fails
func parsePort(s string) int {
    port, _ := strconv.Atoi(s)  // Ignoring error!
    return port  // Returns 0 if s is invalid — port 0 is invalid!
}

// GOOD
func parsePort(s string) (int, error) {
    port, err := strconv.Atoi(s)
    if err != nil {
        return 0, fmt.Errorf("invalid port %q: %w", s, err)
    }
    if port < 1 || port > 65535 {
        return 0, fmt.Errorf("port %d out of valid range [1, 65535]", port)
    }
    return port, nil
}
```

### Anti-Pattern 2: Panicking Type Assertions in Library Code

```go
// BAD — panics if called with wrong type
func processItem(item interface{}) {
    data := item.(map[string]interface{})  // PANIC if not a map!
    // ...
}

// GOOD — graceful handling
func processItem(item interface{}) error {
    data, ok := item.(map[string]interface{})
    if !ok {
        return fmt.Errorf("expected map, got %T", item)
    }
    _ = data
    return nil
}
```

### Anti-Pattern 3: Using Conversion to "Reset" Type Safety

```go
// BAD — defeats the purpose of distinct types
type UserID int64
type ProductID int64

func getUser(id UserID) *User { return nil }

userID := UserID(123)
productID := ProductID(456)

// This compiles but is semantically wrong:
getUser(UserID(productID))  // Converting ProductID to UserID to "make it work"
// The types exist to prevent exactly this!
```

### Anti-Pattern 4: Repeated []byte ↔ string in Loop

```go
// BAD — allocates on every iteration
func countBytes(s string, target byte) int {
    count := 0
    for i := 0; i < len(s); i++ {
        if []byte(s)[i] == target {  // WRONG: converts entire string each iteration!
            count++
        }
    }
    return count
}

// GOOD — convert once, or use direct byte access
func countBytes(s string, target byte) int {
    count := 0
    for i := 0; i < len(s); i++ {
        if s[i] == target {  // s[i] gives byte directly without conversion
            count++
        }
    }
    return count
}
```

---

## 8. Debugging Guide

### Problem 1: Unexpected "A" instead of "65"

**Symptom:**
```go
n := 65
msg := "Code: " + string(n)
fmt.Println(msg)  // Prints: "Code: A" — expected "Code: 65"
```

**Debug:**
```go
fmt.Printf("Type: %T, Value: %v\n", string(n), string(n))
// Type: string, Value: A
```

**Fix:**
```go
msg := "Code: " + strconv.Itoa(n)
```

### Problem 2: Integer Overflow in Config Parsing

**Symptom:**
```go
// User sets TIMEOUT_SECONDS=300
val, _ := strconv.Atoi(os.Getenv("TIMEOUT_SECONDS"))
timeout := int8(val)  // 300 → int8 overflow → 44!
```

**Debug:**
```go
fmt.Printf("Original: %d, After int8: %d\n", val, int8(val))
// Original: 300, After int8: 44
```

**Fix:**
```go
if val > 127 {
    return errors.New("timeout exceeds int8 range")
}
timeout := int8(val)
```

### Problem 3: Float Precision Loss

**Symptom:**
```go
var balance int64 = 9007199254740993  // 2^53 + 1
balanceFloat := float64(balance)
restored := int64(balanceFloat)
fmt.Println(balance == restored)  // false!
```

**Debug:**
```go
fmt.Printf("Original:  %d\n", balance)
fmt.Printf("As float64: %.0f\n", balanceFloat)
fmt.Printf("Restored:  %d\n", restored)
// Original:  9007199254740993
// As float64: 9007199254740992  ← lost last bit!
// Restored:  9007199254740992
```

**Fix:** Use `decimal` library or store monetary values as integers (cents).

---

## 9. Comparison with Other Languages

### Go vs Java

```java
// Java — widening is implicit, narrowing requires cast
int i = 42;
double d = i;        // implicit widening — OK
int j = (int) d;     // explicit narrowing cast
String s = String.valueOf(i);  // integer to string
```

```go
// Go — ALL conversions explicit
var i int = 42
var d float64 = float64(i)  // must be explicit
var j int = int(d)           // explicit
s := strconv.Itoa(i)         // use strconv
```

### Go vs Python

```python
# Python — fully dynamic, no conversion needed
x = 42
y = 3.14
z = x + y    # implicit int→float, z = 45.14
s = str(x)   # str() function
```

```go
// Go — must be explicit
var x int = 42
var y float64 = 3.14
z := float64(x) + y           // explicit
s := strconv.Itoa(x)
```

### Go vs C

```c
// C — implicit conversions everywhere, including dangerous pointer casts
int i = 300;
char c = i;     // implicit narrowing, c = 44 (no warning by default!)
void *p = &i;
int *ip = p;    // implicit pointer conversion
```

```go
// Go — no implicit narrowing, no pointer conversion without unsafe
var i int = 300
var c int8 = int8(i)  // explicit — you acknowledge potential overflow
// No automatic pointer type conversion at all
```

### Go vs Rust

```rust
// Rust — uses 'as' keyword, similar to Go but with saturating options
let i: i32 = 300;
let c: i8 = i as i8;          // wraps like Go (no panic)
let c_sat: i8 = i.clamp(-128, 127) as i8;  // saturating conversion
```

```go
// Go — uses T(v) syntax
var i int = 300
var c int8 = int8(i)  // wraps (same as Rust 'as')
// No built-in saturating conversion in Go (must implement manually)
```

---

## 10. Real-World Analogies (Advanced)

**Domain-Driven Design Analogy:**
Named types with conversion restrictions are like having `CustomerAge` and `ProductQuantity` as distinct business concepts. Even though both are integers in the database, you don't want to accidentally use a customer's age as a product quantity. Go's type system enforces this at compile time.

**API Boundary Analogy:**
`strconv` functions are like API gateways — they validate and translate between the "string world" (HTTP, environment variables, user input) and the "typed world" (Go values), returning errors when translation fails.

---

## 11. Mental Models (Advanced)

**Model: The Type Graph**
Imagine types as nodes in a graph. An edge exists between two types only if there's a valid conversion. Some edges are "safe" (widening), some are "dangerous" (narrowing). In Go, you must traverse every edge explicitly.

**Model: Semantic Containers**
A `UserID` and a `ProductID`, both backed by `int64`, are different containers with different semantic labels. Converting between them requires intentional code, preventing accidental mixing.

---

## 12. Pros and Cons (Advanced Analysis)

### Pros
- **Compile-time bug prevention:** The `UserID`/`ProductID` confusion is caught at compile time
- **Code search:** You can grep for `UserID(` to find all conversion points
- **Refactoring safety:** Changing the underlying type of `UserID` from `int64` to `string` will cause compile errors at all conversion sites — easy to find and fix

### Cons
- **API verbosity:** Working with numeric types in math-heavy code requires constant conversion
- **strconv boilerplate:** Parsing config files requires significant error-handling boilerplate
- **No covariance:** Cannot return a `[]MyString` where `[]string` is expected, even if `MyString = string`

---

## 13. Use Cases (Intermediate)

### Use Case 1: Domain Modeling with Type Safety
```go
type UserID int64
type OrderID int64
type Amount float64

func (a Amount) String() string {
    return fmt.Sprintf("$%.2f", float64(a))
}

func createOrder(userID UserID, amount Amount) OrderID {
    // Compiler prevents: createOrder(OrderID(123), amount)  ← wrong type!
    return OrderID(generateID())
}

func generateID() int64 { return 42 }
```

### Use Case 2: HTTP Handler with Parsing
```go
func getUserHandler(w http.ResponseWriter, r *http.Request) {
    idStr := r.URL.Query().Get("id")
    id, err := strconv.ParseInt(idStr, 10, 64)
    if err != nil {
        http.Error(w, "invalid id", http.StatusBadRequest)
        return
    }
    userID := UserID(id)
    _ = userID
    // use userID...
}
```

### Use Case 3: JSON Unmarshaling Type Conversion
```go
// JSON numbers unmarshal to float64 by default
var data map[string]interface{}
json.Unmarshal([]byte(`{"count": 42}`), &data)

// Must convert float64 to int
count, ok := data["count"].(float64)
if !ok {
    return errors.New("count not a number")
}
intCount := int(count)
fmt.Println(intCount)  // 42
```

---

## 14. Code Examples (Intermediate)

### Example 1: Generic Conversion Helper (Go 1.18+)
```go
package main

import (
    "fmt"
    "golang.org/x/exp/constraints"
)

// Convert converts any ordered numeric type to another
func Convert[From, To constraints.Integer | constraints.Float](v From) To {
    return To(v)
}

func main() {
    var x int32 = 100
    y := Convert[int32, float64](x)
    fmt.Println(y)  // 100.0
}
```

### Example 2: Safe Numeric Conversion with Range Check
```go
package main

import (
    "errors"
    "fmt"
    "math"
)

var ErrOverflow = errors.New("value overflows target type")

func ToInt8(n int) (int8, error) {
    if n < math.MinInt8 || n > math.MaxInt8 {
        return 0, fmt.Errorf("%w: %d doesn't fit in int8", ErrOverflow, n)
    }
    return int8(n), nil
}

func ToUint16(n int) (uint16, error) {
    if n < 0 || n > math.MaxUint16 {
        return 0, fmt.Errorf("%w: %d doesn't fit in uint16", ErrOverflow, n)
    }
    return uint16(n), nil
}

func main() {
    v, err := ToInt8(200)
    if err != nil {
        fmt.Println("Error:", err)  // overflow!
    }
    _ = v

    v2, err := ToInt8(100)
    if err != nil {
        fmt.Println("Error:", err)
    }
    fmt.Println("Value:", v2)  // 100
}
```

### Example 3: Efficient Buffer Processing
```go
package main

import (
    "fmt"
    "strings"
)

// processChunk converts a network buffer to string only once
func processChunk(buf []byte, n int) {
    // Single conversion: only the valid portion
    data := string(buf[:n])

    // Process the string
    lines := strings.Split(data, "\n")
    for _, line := range lines {
        fmt.Println("Line:", line)
    }
}

func main() {
    buf := []byte("hello\nworld\nfoo")
    processChunk(buf, len(buf))
}
```

### Example 4: Type Switch for Heterogeneous Data
```go
package main

import (
    "fmt"
    "strconv"
)

// normalize converts various types to their canonical string form
func normalize(v interface{}) string {
    switch val := v.(type) {
    case string:
        return val
    case int:
        return strconv.Itoa(val)
    case int64:
        return strconv.FormatInt(val, 10)
    case float64:
        return strconv.FormatFloat(val, 'f', -1, 64)
    case bool:
        return strconv.FormatBool(val)
    case []byte:
        return string(val)
    case nil:
        return ""
    default:
        return fmt.Sprintf("%v", val)
    }
}

func main() {
    values := []interface{}{42, "hello", 3.14, true, []byte("bytes"), nil}
    for _, v := range values {
        fmt.Printf("%T → %q\n", v, normalize(v))
    }
}
```

---

## 15. Clean Code (Intermediate)

### Principle: Name Your Conversions

```go
// OK but cryptic
result := float64(a) / float64(b)

// Better — explain intent
numerator := float64(a)
denominator := float64(b)
ratio := numerator / denominator
```

### Principle: Conversion at System Boundaries

Conversions should happen at the boundary between "untyped" external data and "typed" internal representations:

```go
// Conversion happens once, at the boundary
func parseRequest(r *http.Request) (*CreateUserRequest, error) {
    ageStr := r.FormValue("age")
    age, err := strconv.Atoi(ageStr)  // convert at the boundary
    if err != nil {
        return nil, fmt.Errorf("invalid age: %w", err)
    }
    return &CreateUserRequest{Age: age}, nil
}

// Internal code works with typed values — no conversions needed
func createUser(req *CreateUserRequest) error {
    // req.Age is already int — no conversion needed here
    if req.Age < 0 || req.Age > 150 {
        return errors.New("age out of range")
    }
    return nil
}
```

---

## 16. Error Handling (Intermediate)

### Wrapping strconv Errors

```go
type ParseError struct {
    Field   string
    Value   string
    Wrapped error
}

func (e *ParseError) Error() string {
    return fmt.Sprintf("field %q: cannot parse %q: %v", e.Field, e.Value, e.Wrapped)
}

func (e *ParseError) Unwrap() error {
    return e.Wrapped
}

func parseIntField(field, value string) (int, error) {
    n, err := strconv.Atoi(value)
    if err != nil {
        return 0, &ParseError{Field: field, Value: value, Wrapped: err}
    }
    return n, nil
}
```

---

## 17. Security Considerations (Intermediate)

### Integer Overflow in Security-Critical Code

```go
// DANGEROUS: converting user-controlled length to int8
func allocateBuffer(sizeStr string) ([]byte, error) {
    size, err := strconv.Atoi(sizeStr)
    if err != nil {
        return nil, err
    }
    bufSize := int8(size)  // DANGER: "256" → 0, "300" → 44
    return make([]byte, bufSize), nil
}

// SAFE: validate before narrowing
func allocateBufferSafe(sizeStr string) ([]byte, error) {
    size, err := strconv.Atoi(sizeStr)
    if err != nil {
        return nil, err
    }
    if size <= 0 || size > 1024*1024 {  // max 1MB
        return nil, fmt.Errorf("invalid buffer size: %d", size)
    }
    return make([]byte, size), nil
}
```

---

## 18. Performance Tips (Intermediate)

```go
// Benchmark: strconv vs fmt.Sprintf
// BenchmarkStrconvItoa-8    50000000    28.5 ns/op    2 B/op    1 alloc/op
// BenchmarkFmtSprintf-8      5000000   230.0 ns/op   32 B/op    2 allocs/op

// Avoid conversion in hot paths by pre-converting
type Server struct {
    portStr string  // Pre-converted for logging
    port    int
}

func NewServer(port int) *Server {
    return &Server{
        port:    port,
        portStr: strconv.Itoa(port),  // convert once
    }
}

// Convert []byte to string only when needed
func process(data []byte) {
    // Check length without converting
    if len(data) == 0 {
        return
    }
    // Convert only when you actually need string operations
    s := string(data)
    // ... use s
    _ = s
}
```

---

## 19. Best Practices (Intermediate)

1. **Validate before narrowing:** Always check ranges before int→int8, int→uint8, etc.
2. **Wrap errors with context:** Include the field name and input value in parse errors
3. **Convert at boundaries:** Do all string→typed conversions at the entry point (HTTP handlers, CLI args)
4. **Use named types for domain safety:** `UserID int64` prevents mixing with `ProductID int64`
5. **Avoid `string(intVal)`:** This is almost always a bug — use `strconv.Itoa`
6. **Prefer `strconv` over `fmt.Sprintf`** for simple int/float-to-string when performance matters

---

## 20. Edge Cases and Pitfalls (Intermediate)

```go
// Pitfall 1: Untyped constants don't need conversion
const x = 100
var f float64 = x  // OK — untyped constant adapts

// Pitfall 2: Typed constants DO need conversion
const y int = 100
// var f2 float64 = y  // COMPILE ERROR — y is typed
var f2 float64 = float64(y)  // Must convert

// Pitfall 3: NaN and Inf behavior when converting to int
f := math.NaN()
i := int(f)   // Implementation-defined! Usually 0 or random value
fmt.Println(i)  // Don't rely on this

// Pitfall 4: Negative float to uint
f2 := -1.0
u := uint(int(f2))  // int(-1.0)=-1, then uint(-1)=huge number
```

---

## 21. Common Mistakes (Intermediate)

```go
// Mistake 1: Assuming byte == character for Unicode
s := "Hello, 世界"
for i := 0; i < len(s); i++ {
    fmt.Printf("%c", s[i])  // WRONG: s[i] is byte, not rune — garbles Unicode!
}
// CORRECT:
for _, r := range s {
    fmt.Printf("%c", r)  // range on string gives runes
}

// Mistake 2: Converting to *different* interface types
// This doesn't work without type assertions:
// var r io.Reader = ...
// var w io.Writer = r  // COMPILE ERROR even if underlying type has Write
```

---

## 22. Common Misconceptions (Intermediate)

**Misconception: "Named types are just aliases"**
```go
type Km float64
type Miles float64
// These are NOT aliases — they're distinct types!
// You can't pass Km where Miles is expected.
```

**Misconception: "Type conversion preserves method sets"**
```go
type MyReader struct{}
func (r MyReader) Read(p []byte) (int, error) { return 0, nil }

type NotReader MyReader
// NotReader does NOT have the Read method!
// Converting MyReader → NotReader creates a type without those methods.
```

---

## 23. Tricky Points (Intermediate)

```go
// Trick: []T cannot be converted to []OtherT even if T converts to OtherT
var ints []int = []int{1, 2, 3}
// var floats []float64 = []float64(ints)  // COMPILE ERROR!
// Must convert element by element:
floats := make([]float64, len(ints))
for i, v := range ints {
    floats[i] = float64(v)
}

// Trick: struct conversion requires identical field names and types
type Point struct{ X, Y int }
type Coord struct{ X, Y int }

p := Point{1, 2}
c := Coord(p)  // OK! Same field names and types
fmt.Println(c) // {1 2}

// But:
type Point3D struct{ X, Y, Z int }
// _ = Point3D(p)  // COMPILE ERROR — different structure
```

---

## 24. Test (Quiz)

**Q1.** What is printed?
```go
type Celsius float64
type Fahrenheit float64
var c Celsius = 100
fmt.Println(float64(c) * 9/5 + 32)
```
Answer: `212` (100°C = 212°F)

**Q2.** Does this compile?
```go
type MySlice []int
var s []int = []int{1, 2, 3}
var ms MySlice = MySlice(s)
```
Answer: Yes — slice types with same element type can be converted.

**Q3.** What is `int(math.Inf(1))`?
Answer: Implementation-defined behavior — don't rely on it. In practice, often gives a very large or 0 value. This is undefined behavior in the Go spec.

**Q4.** Given `type Handler func(http.ResponseWriter, *http.Request)`, can you convert a compatible function to `Handler`?
```go
func myFunc(w http.ResponseWriter, r *http.Request) {}
h := Handler(myFunc)  // Does this work?
```
Answer: Yes! Function types with identical signatures can be converted.

---

## 25. Tricky Questions

**Q: Can you convert between two interface types?**
No direct conversion. You assign one interface to another only if the underlying concrete type satisfies both interfaces. Otherwise you need a type assertion to the concrete type.

**Q: Why can't you use `[]string(myStringSlice)` if `myStringSlice` is `[]MyString` and `type MyString string`?**
Slice conversion requires both the slice type and element type to be convertible. Even though `MyString` converts to `string`, `[]MyString` does NOT convert to `[]string` — they're different slice types with different memory layouts (potentially different alignment, though in practice the same for string vs MyString).

---

## 26. Cheat Sheet

```go
// NAMED TYPE CONVERSIONS
type Meters float64
var d Meters = 100
plain := float64(d)     // Meters → float64
back := Meters(plain)   // float64 → Meters

// STRUCT CONVERSION (identical fields)
type A struct{ X, Y int }
type B struct{ X, Y int }
a := A{1, 2}
b := B(a)  // OK

// SLICE ELEMENT CONVERSION (must be manual)
ints := []int{1, 2, 3}
floats := make([]float64, len(ints))
for i, v := range ints { floats[i] = float64(v) }

// TYPE SWITCH
switch v := x.(type) {
case string:  // v is string
case int:     // v is int
default:      // v is interface{}
}

// FUNCTION TYPE CONVERSION
type Handler func(string) string
fn := Handler(myFunc)  // OK if signatures match

// CONSTANT CONVERSION
const (
    untyped = 100           // adapts to context
    typed   int = 100       // requires explicit float64(typed)
)
```

---

## 27. Self-Assessment Checklist

- [ ] I understand why Go requires explicit conversions
- [ ] I know the difference between type aliases and type definitions
- [ ] I can use named types for domain safety
- [ ] I convert at system boundaries, not deep in business logic
- [ ] I wrap strconv errors with meaningful context
- [ ] I understand that `[]T` cannot be bulk-converted to `[]U`
- [ ] I know about struct type conversion (identical fields)
- [ ] I can use type switches for heterogeneous data
- [ ] I validate ranges before narrowing conversions
- [ ] I understand that function types with same signatures can be converted

---

## 28. Summary

At the middle level, type conversion becomes a tool for architecture and correctness. Named types with distinct identities allow domain modeling that prevents semantic errors at compile time. Conversions happen at system boundaries (parsing HTTP requests, reading environment variables, unmarshaling JSON). Anti-patterns include ignored strconv errors, panicking type assertions in library code, and repeated conversions in hot loops. The key insight is: **every conversion in Go is a decision point**, and placing those decision points deliberately (at boundaries, with proper error handling) is what separates professional Go code from beginner code.

---

## 29. What You Can Build

- A type-safe configuration loader using named types
- A currency conversion service with distinct `USD`, `EUR`, `GBP` types
- A domain model for an e-commerce system using `UserID`, `ProductID`, `OrderID`
- A CSV/JSON parser that converts all fields at the boundary layer
- A unit conversion library with compile-time type safety

---

## 30. Further Reading

- [Go spec: Conversions](https://go.dev/ref/spec#Conversions)
- [Go spec: Assignability](https://go.dev/ref/spec#Assignability)
- [Dave Cheney: Typed vs untyped constants](https://dave.cheney.net/2014/10/17/functional-options-for-friendly-apis)
- [strconv package docs](https://pkg.go.dev/strconv)
- [Go blog: The Go type system](https://go.dev/blog/laws-of-reflection)

---

## 31. Related Topics

- Interfaces and duck typing
- Generics and type constraints
- The `reflect` package
- JSON marshaling/unmarshaling
- Protocol Buffers and wire format conversions
