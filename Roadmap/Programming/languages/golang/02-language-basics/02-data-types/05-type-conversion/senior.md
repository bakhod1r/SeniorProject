# Type Conversion in Go — Senior Level

## Focus: How to Optimize and How to Architect

---

## 1. Introduction

At the senior level, type conversion transcends syntax — it becomes an architectural concern. This level covers zero-copy techniques, the reflect package, generics-based conversion, unsafe patterns for performance, and system design decisions around type boundaries. Understanding conversion at this level means you can design APIs that minimize conversions, optimize hot paths by eliminating allocation, and reason about the runtime cost of every type boundary.

---

## 2. Architecture with Type Conversion

### 2.1 Boundary Architecture

In large systems, type conversion should be structured as explicit layers:

```
External World         Boundary Layer          Domain Layer
(strings, bytes,   →  (parse, validate,    →  (typed, safe,
 JSON, CSV, env)       convert, error-wrap)     no conversions)
```

```go
// boundary/http.go — ALL conversions happen here
package boundary

type CreateOrderRequest struct {
    UserID   UserID
    Amount   Money
    Currency Currency
}

func ParseCreateOrder(r *http.Request) (*CreateOrderRequest, error) {
    userIDStr := r.URL.Query().Get("user_id")
    userID, err := ParseUserID(userIDStr)
    if err != nil {
        return nil, NewValidationError("user_id", err)
    }

    amountStr := r.FormValue("amount")
    amount, err := ParseMoney(amountStr)
    if err != nil {
        return nil, NewValidationError("amount", err)
    }

    return &CreateOrderRequest{UserID: userID, Amount: amount}, nil
}

// domain/order.go — zero conversions here
package domain

func CreateOrder(req boundary.CreateOrderRequest) (*Order, error) {
    // All values are already typed — no conversion needed
    if req.Amount <= 0 {
        return nil, ErrInvalidAmount
    }
    return &Order{UserID: req.UserID, Amount: req.Amount}, nil
}
```

### 2.2 Conversion-Free Interfaces

Design interfaces that accept the native types callers have:

```go
// BAD API — forces callers to convert
type UserRepository interface {
    FindByID(id string) (*User, error)  // forces string conversion from typed ID
}

// GOOD API — accepts the domain type
type UserRepository interface {
    FindByID(id UserID) (*User, error)  // callers keep their typed value
}
```

---

## 3. Zero-Copy Techniques

### 3.1 String-to-Bytes Without Allocation

The standard `[]byte(s)` always copies. For read-only access in hot paths, you can use `unsafe` to avoid allocation:

```go
package zerocopy

import (
    "unsafe"
)

// StringToBytes converts a string to a byte slice without allocation.
// CRITICAL: The returned slice must NOT be modified — the string is immutable!
// This is safe for read-only operations only.
func StringToBytes(s string) []byte {
    if len(s) == 0 {
        return nil
    }
    // StringHeader and SliceHeader share the same memory layout
    sp := unsafe.StringData(s)  // Go 1.20+
    return unsafe.Slice(sp, len(s))
}

// BytesToString converts a byte slice to string without allocation.
// CRITICAL: The original byte slice must NOT be modified after conversion!
func BytesToString(b []byte) string {
    if len(b) == 0 {
        return ""
    }
    return unsafe.String(unsafe.SliceData(b), len(b))
}
```

**When to use this:**
- Reading HTTP headers/bodies for comparison (not modification)
- Hash computation over string data
- Serialization of strings into pre-allocated buffers

**When NOT to use:**
- When the byte slice might be modified later
- When the string may be garbage collected before you're done with the bytes
- In library code that will be used by others (document it carefully)

### 3.2 The `sync.Pool` Pattern for Buffers

```go
var bufPool = sync.Pool{
    New: func() interface{} {
        return make([]byte, 0, 4096)
    },
}

func processRequest(s string) string {
    buf := bufPool.Get().([]byte)
    buf = buf[:0]  // reset without reallocating

    // Use the buffer without string→[]byte→string conversion cycle
    buf = append(buf, s...)
    buf = append(buf, " processed"...)

    result := string(buf)  // final conversion, unavoidable
    bufPool.Put(buf)
    return result
}
```

---

## 4. Generics and Type Conversion (Go 1.18+)

### 4.1 Type Conversion Constraints

```go
package convert

import "golang.org/x/exp/constraints"

// Number combines all numeric types
type Number interface {
    constraints.Integer | constraints.Float
}

// SafeConvert converts between numeric types with overflow detection
func SafeConvert[From, To Number](v From) (To, bool) {
    result := To(v)
    // Verify no data loss by converting back
    if From(result) != v {
        return 0, false
    }
    return result, true
}

// ToSlice converts a slice of one numeric type to another
func ToSlice[From, To Number](src []From) []To {
    dst := make([]To, len(src))
    for i, v := range src {
        dst[i] = To(v)
    }
    return dst
}
```

### 4.2 Generic String Conversion

```go
// Stringer interface for types that can convert to string
type Stringer[T any] interface {
    ToString(T) string
    FromString(string) (T, error)
}

// NumericConverter handles all numeric type conversions
type NumericConverter[T constraints.Integer | constraints.Float] struct{}

func (NumericConverter[T]) ToString(v T) string {
    return fmt.Sprintf("%v", v)
}
```

---

## 5. Reflection-Based Conversion

### 5.1 Dynamic Type Conversion

```go
package reflect_convert

import (
    "fmt"
    "reflect"
    "strconv"
)

// ConvertValue attempts to convert a reflect.Value to a target type
func ConvertValue(v reflect.Value, targetType reflect.Type) (reflect.Value, error) {
    sourceType := v.Type()

    // Direct conversion if types are convertible
    if sourceType.ConvertibleTo(targetType) {
        return v.Convert(targetType), nil
    }

    // Special case: string → numeric
    if sourceType.Kind() == reflect.String && isNumeric(targetType.Kind()) {
        return parseStringToNumeric(v.String(), targetType)
    }

    // Special case: numeric → string
    if isNumeric(sourceType.Kind()) && targetType.Kind() == reflect.String {
        return reflect.ValueOf(fmt.Sprintf("%v", v.Interface())).
            Convert(targetType), nil
    }

    return reflect.Value{}, fmt.Errorf("cannot convert %v to %v", sourceType, targetType)
}

func isNumeric(k reflect.Kind) bool {
    switch k {
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64,
        reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64,
        reflect.Float32, reflect.Float64:
        return true
    }
    return false
}

func parseStringToNumeric(s string, t reflect.Type) (reflect.Value, error) {
    switch t.Kind() {
    case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
        n, err := strconv.ParseInt(s, 10, t.Bits())
        if err != nil {
            return reflect.Value{}, err
        }
        v := reflect.New(t).Elem()
        v.SetInt(n)
        return v, nil
    case reflect.Float32, reflect.Float64:
        n, err := strconv.ParseFloat(s, t.Bits())
        if err != nil {
            return reflect.Value{}, err
        }
        v := reflect.New(t).Elem()
        v.SetFloat(n)
        return v, nil
    }
    return reflect.Value{}, fmt.Errorf("unsupported type: %v", t)
}
```

### 5.2 Struct Field Mapping with Conversions

```go
// MapStruct copies fields from src to dst with type conversion
func MapStruct(src, dst interface{}) error {
    srcVal := reflect.ValueOf(src)
    dstVal := reflect.ValueOf(dst)

    if srcVal.Kind() != reflect.Struct {
        return fmt.Errorf("src must be struct, got %T", src)
    }
    if dstVal.Kind() != reflect.Ptr || dstVal.Elem().Kind() != reflect.Struct {
        return fmt.Errorf("dst must be pointer to struct")
    }

    srcType := srcVal.Type()
    dstElem := dstVal.Elem()
    dstType := dstElem.Type()

    for i := 0; i < srcType.NumField(); i++ {
        srcField := srcType.Field(i)
        dstField, ok := dstType.FieldByName(srcField.Name)
        if !ok {
            continue
        }

        srcFV := srcVal.Field(i)
        dstFV := dstElem.FieldByIndex(dstField.Index)

        if srcFV.Type().ConvertibleTo(dstFV.Type()) {
            dstFV.Set(srcFV.Convert(dstFV.Type()))
        }
    }
    return nil
}
```

---

## 6. Unsafe Conversions for Performance

### 6.1 When unsafe Is Justified

```go
package unsafe_patterns

import (
    "unsafe"
)

// FastStringHash computes a hash without allocating []byte
func FastStringHash(s string) uint64 {
    b := unsafe.Slice(unsafe.StringData(s), len(s))
    // Process bytes without any allocation
    var h uint64 = 14695981039346656037
    for _, c := range b {
        h ^= uint64(c)
        h *= 1099511628211
    }
    return h
}

// Pointer conversion example (use with extreme care)
func Float64BitsToUint64(f float64) uint64 {
    // Zero-copy reinterpretation of bit pattern
    return *(*uint64)(unsafe.Pointer(&f))
    // Equivalent to math.Float64bits(f) but shows the unsafe pattern
}

// The safe version using math package:
// return math.Float64bits(f)
```

### 6.2 The Risks of unsafe

```go
// DANGEROUS — violates memory safety
func DangerousStringToBytes(s string) []byte {
    // This can cause memory corruption if the returned slice is modified!
    // The garbage collector may move the string's memory.
    type stringHeader struct {
        Data unsafe.Pointer
        Len  int
    }
    type sliceHeader struct {
        Data unsafe.Pointer
        Len  int
        Cap  int
    }
    sh := (*stringHeader)(unsafe.Pointer(&s))
    bh := sliceHeader{Data: sh.Data, Len: sh.Len, Cap: sh.Len}
    return *(*[]byte)(unsafe.Pointer(&bh))
    // DO NOT USE THIS — shown only to explain what NOT to do
}

// SAFE alternative (Go 1.20+)
func SafeStringToBytes(s string) []byte {
    return unsafe.Slice(unsafe.StringData(s), len(s))
    // Still read-only — modifying causes undefined behavior
}
```

---

## 7. Compiler Perspective

### 7.1 How the Compiler Handles Conversions

For numeric conversions, the Go compiler generates single CPU instructions:
- `int → float64`: `CVTSI2SD` (x86) — 1 cycle
- `float64 → int`: `CVTTSD2SI` (x86) — 1 cycle
- `int → int8`: single `MOVBQSX` — 1 cycle (with truncation)

For string conversions, the compiler generates `runtime.slicebytetostring` and `runtime.stringtoslice` calls, which call `mallocgc`. These have costs:
- Memory allocation: ~30-100ns
- GC pressure proportional to allocation rate

The compiler **does** optimize some conversions away:
```go
// The compiler avoids allocation in these cases:
for i, b := range []byte(s) {}  // no allocation for range
m[string(key)] = value          // no allocation for map lookup
```

### 7.2 Assembly Output Analysis

```go
// Compile with: go build -gcflags='-S' to see assembly
func addNumbers(a int, b float64) float64 {
    return float64(a) + b
    // Compiles to approximately:
    // MOVQ  a+0(FP), AX        ; load int
    // CVTSI2SDQ AX, X0         ; convert int64 → float64
    // ADDSD b+8(FP), X0        ; add float64 values
    // MOVSD X0, ret+16(FP)     ; store result
}
```

---

## 8. Memory Layout and Representation

### 8.1 String Internal Layout

```
type StringHeader struct {
    Data uintptr  // pointer to underlying array
    Len  int      // length in bytes
}

"hello":
┌──────────────────┬─────┐
│ Data: 0xc0001234 │ Len │
│                  │  5  │
└──────────────────┴─────┘
         │
         ▼
┌───┬───┬───┬───┬───┐
│ h │ e │ l │ l │ o │  ← immutable memory
└───┴───┴───┴───┴───┘
```

When you do `[]byte(s)`:
```
New SliceHeader:
┌──────────────────┬─────┬─────┐
│ Data: 0xd0001234 │ Len │ Cap │  ← NEW pointer
│                  │  5  │  5  │
└──────────────────┴─────┴─────┘
         │
         ▼
┌───┬───┬───┬───┬───┐
│ h │ e │ l │ l │ o │  ← NEW allocation, copied bytes
└───┴───┴───┴───┴───┘
```

### 8.2 Numeric Conversion Bit Patterns

```
int8(200):
200 in binary: 1100 1000
As int8:       1100 1000  ← same bits, interpreted as signed = -56

int(3.14) truncation:
3.14 in IEEE754: 0 10000000 10010001111010111000010...
Mantissa: 1.10010001... = 1 + 0.5 + 0.0625... ≈ 3.14
Truncate to int: 3
```

---

## 9. Postmortems and System Failures

### Incident 1: Integer Overflow in Financial System

**What happened:** A fintech system calculated total transaction amounts using `int32`. When the total exceeded 2^31-1 ($2.147 billion), it silently wrapped to a negative number. A large payment was processed, then the balance appeared negative — triggering fraud alerts and locking thousands of accounts.

**Root cause:**
```go
// BUGGY CODE
type Amount int32  // int32 max = $21,474,836.47 at cents precision

func sumTransactions(txns []Transaction) Amount {
    var total int32
    for _, t := range txns {
        total += int32(t.Amount)  // wraps silently!
    }
    return Amount(total)
}
```

**Fix:**
```go
type Amount int64  // int64 max = ~$92 quadrillion

func sumTransactions(txns []Transaction) (Amount, error) {
    var total int64
    for _, t := range txns {
        total += int64(t.Amount)
        if total < 0 {
            return 0, errors.New("amount overflow detected")
        }
    }
    return Amount(total), nil
}
```

**Lesson:** Financial values should use `int64` (or `decimal.Decimal` library). Always check for overflow when summing user-controlled values.

### Incident 2: float64 Precision in Distributed Counter

**What happened:** A distributed system used `float64` to accumulate event counts, syncing across nodes. After billions of events, the counters on different nodes diverged — float64 loses precision for integers above 2^53.

**Root cause:**
```go
type EventCounter struct {
    count float64  // WRONG — should be int64
}

func (c *EventCounter) Increment() {
    c.count++  // Fine until count > 9007199254740992 (2^53)
}
```

**Fix:** Use `int64` for counters, `float64` only for actual floating-point data.

### Incident 3: string(bytes) Memory Leak

**What happened:** A high-throughput server was converting network buffers (`[]byte`) to strings for logging. Each request was creating multiple string copies, and since the log messages contained URLs, the allocations were large. GC pressure caused 200ms pause spikes.

**Root cause:**
```go
func logRequest(buf []byte) {
    url := string(buf)  // allocates every request
    log.Printf("Request: %s", url)
}
```

**Fix:**
```go
func logRequest(buf []byte) {
    // Use %s with []byte directly — no allocation needed for fmt.Printf
    log.Printf("Request: %s", buf)
    // OR use the unsafe zero-copy pattern for very hot paths
}
```

---

## 10. Performance Optimization

### 10.1 Profiling Conversion Overhead

```go
// Use pprof to identify conversion hotspots
import (
    "runtime/pprof"
    "os"
)

func main() {
    f, _ := os.Create("cpu.prof")
    pprof.StartCPUProfile(f)
    defer pprof.StopCPUProfile()
    // ... your code
}
// Then: go tool pprof cpu.prof
// Look for: runtime.slicebytetostring, runtime.stringtoslice
```

### 10.2 Conversion Benchmarks

```go
package main

import (
    "strconv"
    "testing"
    "fmt"
)

var result string

func BenchmarkStrconvItoa(b *testing.B) {
    for i := 0; i < b.N; i++ {
        result = strconv.Itoa(i)
    }
}

func BenchmarkFmtSprintf(b *testing.B) {
    for i := 0; i < b.N; i++ {
        result = fmt.Sprintf("%d", i)
    }
}

func BenchmarkStringBytes(b *testing.B) {
    s := "hello world this is a test string"
    var bs []byte
    b.ResetTimer()
    for i := 0; i < b.N; i++ {
        bs = []byte(s)
        _ = bs
    }
}
```

### 10.3 Allocation-Aware Patterns

```go
// Pattern: Pre-allocate and reuse buffers for conversion-heavy operations
type Encoder struct {
    buf []byte
}

func (e *Encoder) EncodeInt(n int) string {
    e.buf = strconv.AppendInt(e.buf[:0], int64(n), 10)
    return string(e.buf)  // still allocates, but buf is reused
}

// For truly zero-allocation, accept an output buffer:
func EncodeIntToBuffer(n int, buf []byte) []byte {
    return strconv.AppendInt(buf, int64(n), 10)
    // Caller owns the buffer — no allocation inside this function
}
```

---

## 11. Advanced Type Assertion Patterns

### 11.1 Avoiding Reflection with Interface Design

```go
// Instead of reflecting on an interface to extract values,
// design interfaces that return what you need:

// BAD: requires reflection or type assertion
type DataSource interface {
    GetData() interface{}
}

// GOOD: typed return
type DataSource[T any] interface {
    GetData() T
}

// Or use an explicit conversion method
type Convertible interface {
    AsString() string
    AsInt() (int, bool)
    AsFloat() (float64, bool)
}
```

### 11.2 Type Assertion Performance

```go
// Interface type assertions have overhead:
// - Single type assertion: ~1-2ns
// - Type switch with many cases: ~3-10ns
// - reflect.TypeOf: ~10-50ns

// For hot paths with known types, prefer direct interface methods
type Processor interface {
    Process() []byte
}

// Faster than asserting to *ConcreteProcessor and calling method
func process(p Processor) {
    data := p.Process()  // virtual dispatch — fast
    _ = data
}

// Even faster: use concrete types where possible (devirtualization)
func processConcreteProcessor(p *ConcreteProcessor) {
    data := p.process()  // direct call, compiler can inline
    _ = data
}

type ConcreteProcessor struct{}
func (p *ConcreteProcessor) Process() []byte  { return nil }
func (p *ConcreteProcessor) process() []byte  { return nil }
```

---

## 12. Design Patterns for Type-Safe APIs

### 12.1 Functional Options with Type Safety

```go
type Config struct {
    Port    int
    Timeout time.Duration
    MaxConn int
}

type Option func(*Config)

func WithPort(port int) Option {
    return func(c *Config) {
        c.Port = port
    }
}

// Type-safe parsing at the option level
func WithPortFromString(portStr string) (Option, error) {
    port, err := strconv.Atoi(portStr)
    if err != nil {
        return nil, fmt.Errorf("invalid port: %w", err)
    }
    return WithPort(port), nil
}
```

### 12.2 Builder Pattern with Conversions

```go
type QueryBuilder struct {
    conditions []string
    args       []interface{}
    errors     []error
}

func (q *QueryBuilder) WhereID(id string) *QueryBuilder {
    n, err := strconv.ParseInt(id, 10, 64)
    if err != nil {
        q.errors = append(q.errors, fmt.Errorf("invalid id %q: %w", id, err))
        return q
    }
    q.conditions = append(q.conditions, "id = ?")
    q.args = append(q.args, n)
    return q
}

func (q *QueryBuilder) Build() (string, []interface{}, error) {
    if len(q.errors) > 0 {
        return "", nil, errors.Join(q.errors...)
    }
    // build query...
    return "", q.args, nil
}
```

---

## 13. Code Examples (Senior)

### Example 1: Memory-Efficient Log Formatter
```go
package main

import (
    "io"
    "strconv"
    "time"
)

// LogEntry formats log entries without unnecessary string allocations
type LogEntry struct {
    Level   string
    Message string
    Time    time.Time
    Fields  map[string]interface{}
}

var levelBytes = map[string][]byte{
    "DEBUG": []byte("DEBUG"),
    "INFO":  []byte("INFO "),
    "WARN":  []byte("WARN "),
    "ERROR": []byte("ERROR"),
}

func (e *LogEntry) WriteTo(w io.Writer) (int64, error) {
    buf := make([]byte, 0, 256)

    // Append timestamp
    buf = e.Time.AppendFormat(buf, time.RFC3339)
    buf = append(buf, ' ')

    // Append level (pre-allocated bytes — no conversion)
    if lb, ok := levelBytes[e.Level]; ok {
        buf = append(buf, lb...)
    } else {
        buf = append(buf, e.Level...)
    }
    buf = append(buf, ' ')

    // Append message
    buf = append(buf, e.Message...)

    // Append fields
    for k, v := range e.Fields {
        buf = append(buf, ' ')
        buf = append(buf, k...)
        buf = append(buf, '=')
        switch val := v.(type) {
        case string:
            buf = append(buf, val...)
        case int:
            buf = strconv.AppendInt(buf, int64(val), 10)
        case float64:
            buf = strconv.AppendFloat(buf, val, 'f', 2, 64)
        case bool:
            buf = strconv.AppendBool(buf, val)
        }
    }
    buf = append(buf, '\n')

    n, err := w.Write(buf)
    return int64(n), err
}
```

### Example 2: Compile-Time Safe Unit System
```go
package units

type Length float64
type Mass float64
type Time float64
type Velocity float64

const (
    Meter     Length   = 1
    Kilometer Length   = 1000
    Mile      Length   = 1609.344
    Second    Time     = 1
    Kilogram  Mass     = 1
)

// Only valid physics: Velocity = Length / Time
func SpeedOf(distance Length, duration Time) Velocity {
    return Velocity(float64(distance) / float64(duration))
}

func (v Velocity) String() string {
    return strconv.FormatFloat(float64(v), 'f', 2, 64) + " m/s"
}

// Compiler prevents: SpeedOf(Mass(10), Time(5)) — wrong types!
```

---

## 14. Testing Strategies

### 14.1 Table-Driven Tests for Conversion Functions
```go
func TestToInt8(t *testing.T) {
    cases := []struct {
        input    int
        wantVal  int8
        wantOK   bool
    }{
        {0, 0, true},
        {127, 127, true},
        {-128, -128, true},
        {128, 0, false},   // overflow
        {-129, 0, false},  // underflow
        {300, 0, false},
    }

    for _, tc := range cases {
        t.Run(fmt.Sprintf("input=%d", tc.input), func(t *testing.T) {
            got, ok := ToInt8(tc.input)
            if ok != tc.wantOK {
                t.Errorf("ToInt8(%d) ok=%v, want %v", tc.input, ok, tc.wantOK)
            }
            if ok && got != tc.wantVal {
                t.Errorf("ToInt8(%d) = %d, want %d", tc.input, got, tc.wantVal)
            }
        })
    }
}
```

### 14.2 Fuzz Testing for Parse Functions
```go
func FuzzParseAmount(f *testing.F) {
    f.Add("1.00")
    f.Add("0")
    f.Add("-1.50")
    f.Add("99999999.99")

    f.Fuzz(func(t *testing.T, input string) {
        amount, err := ParseAmount(input)
        if err != nil {
            return  // invalid input is fine
        }
        // Invariant: converting back to string and parsing again must give same result
        s := amount.String()
        amount2, err2 := ParseAmount(s)
        if err2 != nil {
            t.Errorf("round-trip failed: ParseAmount(%q) → %v → ParseAmount(%q) error: %v",
                input, amount, s, err2)
        }
        if amount != amount2 {
            t.Errorf("round-trip mismatch: %v != %v", amount, amount2)
        }
    })
}
```

---

## 15. Best Practices (Senior)

1. **Design for zero conversions in hot paths** — convert once at the boundary, use typed values everywhere else
2. **Use `unsafe` only with documented invariants** — comment every unsafe conversion with the invariant it relies on
3. **Generics over reflection** — when you need generic conversion, prefer generics (Go 1.18+) over reflect
4. **Benchmark before optimizing** — measure allocation and latency before using unsafe patterns
5. **Named types for domain safety** — invest in named types; the compile-time safety pays dividends
6. **Fuzz test parsing functions** — type conversion at boundaries is a common source of security issues
7. **Use `strconv.Append*` functions** — they write to existing buffers, reducing allocations
8. **Profile, don't guess** — use `go tool pprof` to find real conversion hotspots

---

## 16. Edge Cases (Senior Level)

```go
// Edge 1: NaN/Inf in integer conversion — undefined behavior
n := int(math.NaN())    // implementation-specific
n2 := int(math.Inf(1))  // implementation-specific

// Edge 2: Pointer arithmetic via unsafe (Go differs from C)
// unsafe.Pointer can be converted to uintptr for arithmetic,
// but the result must be converted BACK to unsafe.Pointer in the same expression
// WRONG:
p := uintptr(unsafe.Pointer(&x)) + offset
// ... anything here may invalidate p (GC can move objects!
ptr := (*T)(unsafe.Pointer(p))  // DANGER

// RIGHT: atomic expression
ptr := (*T)(unsafe.Pointer(uintptr(unsafe.Pointer(&x)) + offset))

// Edge 3: Interface comparison after conversion
type MyInt int
var a interface{} = int(5)
var b interface{} = MyInt(5)
fmt.Println(a == b)  // false! Different dynamic types despite same value

// Edge 4: Slice header conversion
type Bytes []byte
var b []byte = []byte{1, 2, 3}
var myB Bytes = Bytes(b)  // OK — same underlying type
```

---

## 17. Common Mistakes (Senior Level)

```go
// Mistake 1: Using uintptr as a persistent pointer
ptr := uintptr(unsafe.Pointer(someObject))
time.Sleep(time.Second)  // GC may have moved someObject!
obj := (*MyType)(unsafe.Pointer(ptr))  // INVALID POINTER

// Mistake 2: Converting pointer then storing in map
m := map[uintptr]string{}
m[uintptr(unsafe.Pointer(&x))] = "x"  // x may move, key becomes invalid

// Mistake 3: Assuming reflect.Value.Convert doesn't panic
// Convert panics if types are not convertible — check ConvertibleTo first
if src.Type().ConvertibleTo(dst.Type()) {
    dst.Set(src.Convert(dst.Type()))
}
```

---

## 18. Performance Metrics

| Operation | Time (approx) | Allocations |
|-----------|--------------|-------------|
| `float64(intVal)` | 0.3 ns | 0 |
| `int(floatVal)` | 0.3 ns | 0 |
| `strconv.Itoa(n)` | 30 ns | 1 (16 bytes) |
| `fmt.Sprintf("%d", n)` | 200 ns | 2 (32+ bytes) |
| `[]byte(s)` (32 bytes) | 15 ns | 1 |
| `string(b)` (32 bytes) | 15 ns | 1 |
| `unsafe.Slice(p, n)` | 0.5 ns | 0 |
| `strconv.AppendInt(buf, n, 10)` | 25 ns | 0 (if buf has capacity) |

---

## 19. Self-Assessment Checklist

- [ ] I can explain how `string → []byte` conversion works at the memory level
- [ ] I use unsafe conversions only when justified and documented
- [ ] I design APIs to minimize conversions at internal call sites
- [ ] I profile allocation from conversions before optimizing
- [ ] I use `strconv.Append*` functions for buffer-based encoding
- [ ] I know when the compiler elides conversion allocations
- [ ] I implement fuzz tests for parsing/conversion functions
- [ ] I use generics for type-parameterized conversion utilities
- [ ] I can read pprof output to identify conversion hotspots
- [ ] I understand the postmortem lessons around integer overflow

---

## 20. Summary

At the senior level, type conversion is an architectural concern. Key principles:
- **Convert once at boundaries** — domain logic should be conversion-free
- **Zero-copy for hot paths** — unsafe patterns eliminate allocation but require careful documentation
- **Generics over reflection** — type-safe, compiler-verified, no runtime overhead
- **Measure first** — never optimize conversions without profiling data
- **Named types as architecture** — `UserID int64` is a design decision, not just a typedef

The deepest insight: every type conversion is a potential data quality boundary. Architects who think about these boundaries design systems that are both type-safe and performant.

---

## 21. What You Can Build

- A zero-allocation log encoder for high-throughput services
- A type-safe units library (physics, finance, geography)
- A generic CSV/JSON parser with compile-time type safety
- A high-performance binary protocol encoder using unsafe patterns
- A reflection-based ORM mapper with proper type conversion

---

## 22. Further Reading

- [Go spec: Conversions](https://go.dev/ref/spec#Conversions)
- [unsafe package docs](https://pkg.go.dev/unsafe)
- [Go execution tracer](https://pkg.go.dev/runtime/trace)
- [Dave Cheney: High Performance Go](https://dave.cheney.net/high-performance-go-workshop/gophercon-2019.html)
- [Dmitri Shuralyov: Go unsafe](https://pkg.go.dev/unsafe#Pointer)

---

## 23. Related Topics

- `sync.Pool` for buffer reuse
- `strings.Builder` for efficient string construction
- Generics and type constraints (Go 1.18+)
- The `reflect` package internals
- Go runtime memory allocator
- `pprof` and performance profiling

---

## 24. Diagrams

### Conversion Overhead Heat Map

```
OPERATION                    COST
─────────────────────────────────────────────
numeric ↔ numeric            ████░░░░░░  LOW
int ↔ named int type         ████░░░░░░  LOW (zero cost)
[]byte ↔ string (small)      ██████████  MEDIUM (allocation)
[]byte ↔ string (large)      ██████████  HIGH (proportional to size)
strconv.Itoa                 ██████░░░░  MEDIUM
fmt.Sprintf                  ████████░░  HIGH
unsafe string↔bytes          ██░░░░░░░░  VERY LOW (no alloc)
reflect.Convert              ████████░░  HIGH
```

### Where to Place Conversions

```
HTTP Request
    │
    ▼
[Handler] ←─── CONVERT HERE: string params → typed values
    │                         check errors, validate ranges
    ▼
[Service] ←─── NO CONVERSIONS: use typed domain values
    │
    ▼
[Repository] ←─ CONVERT HERE: typed values → DB types
    │                          (int64, string, etc.)
    ▼
Database
```
