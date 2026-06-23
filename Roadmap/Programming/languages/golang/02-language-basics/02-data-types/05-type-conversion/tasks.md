# Type Conversion in Go — Practical Tasks

---

## Task 1: Temperature Converter (Beginner)

### Description
Build a temperature converter that works with distinct named types for Celsius, Fahrenheit, and Kelvin. The compiler should prevent accidentally mixing units.

### Requirements
- Define named types `Celsius`, `Fahrenheit`, `Kelvin` (all based on `float64`)
- Implement conversion functions between all three
- Format output to 2 decimal places
- Handle invalid input (temperatures below absolute zero)

### Starter Code
```go
package main

import (
    "fmt"
    "math"
)

type Celsius float64
type Fahrenheit float64
type Kelvin float64

const AbsoluteZeroCelsius Celsius = -273.15

// TODO: Implement these functions
func CelsiusToFahrenheit(c Celsius) Fahrenheit {
    // Formula: F = C * 9/5 + 32
    panic("not implemented")
}

func FahrenheitToCelsius(f Fahrenheit) Celsius {
    // Formula: C = (F - 32) * 5/9
    panic("not implemented")
}

func CelsiusToKelvin(c Celsius) Kelvin {
    // Formula: K = C + 273.15
    panic("not implemented")
}

func KelvinToCelsius(k Kelvin) Celsius {
    // Formula: C = K - 273.15
    panic("not implemented")
}

func (c Celsius) IsValid() bool {
    // TODO: return false if below absolute zero
    panic("not implemented")
}

func main() {
    temps := []Celsius{0, 100, -273.15, -300}
    for _, c := range temps {
        if !c.IsValid() {
            fmt.Printf("%.2f°C is below absolute zero!\n", float64(c))
            continue
        }
        f := CelsiusToFahrenheit(c)
        k := CelsiusToKelvin(c)
        fmt.Printf("%.2f°C = %.2f°F = %.2fK\n", float64(c), float64(f), float64(k))
    }
    _ = math.Abs  // hint: use math.Abs if needed
}
```

### Evaluation Criteria
- [ ] Named types prevent mixing Celsius + Fahrenheit without conversion
- [ ] `CelsiusToFahrenheit(100)` returns `Fahrenheit(212)`
- [ ] `FahrenheitToCelsius(32)` returns `Celsius(0)`
- [ ] `CelsiusToKelvin(0)` returns `Kelvin(273.15)`
- [ ] `IsValid()` returns false for temperatures below -273.15°C
- [ ] Output is formatted to 2 decimal places

---

## Task 2: Safe Integer Parser (Beginner)

### Description
Create a library of safe integer parsing functions that validate ranges and return meaningful errors.

### Requirements
- Parse strings to `int8`, `int16`, `int32`, `int64`, `uint8`, `uint16`, `uint32`, `uint64`
- Return errors with field names and input values
- Handle overflow by returning `ErrOverflow`

### Starter Code
```go
package safeparse

import (
    "errors"
    "fmt"
    "strconv"
)

var ErrOverflow = errors.New("value overflows target type")
var ErrInvalidSyntax = errors.New("invalid numeric syntax")

// ParseInt8 parses a string into int8, validating range.
func ParseInt8(s string) (int8, error) {
    // TODO: use strconv.ParseInt with bitSize=8
    // Return ErrOverflow for range errors
    // Return ErrInvalidSyntax for non-numeric strings
    panic("not implemented")
}

// ParseUint8 parses a string into uint8, validating range.
func ParseUint8(s string) (uint8, error) {
    panic("not implemented")
}

// ParseInt64 parses a string into int64.
func ParseInt64(s string) (int64, error) {
    panic("not implemented")
}

// Example: Usage in config loading
type ServerConfig struct {
    Port    uint16
    Workers int8
    Timeout int32
}

func ParseConfig(portStr, workersStr, timeoutStr string) (*ServerConfig, error) {
    // TODO: parse all fields, collect errors, return combined error
    panic("not implemented")
}
```

### Evaluation Criteria
- [ ] `ParseInt8("127")` returns `127, nil`
- [ ] `ParseInt8("128")` returns `0, ErrOverflow`
- [ ] `ParseInt8("abc")` returns `0, ErrInvalidSyntax`
- [ ] `ParseUint8("-1")` returns `0, ErrOverflow`
- [ ] `ParseConfig` collects all errors and returns them together

---

## Task 3: JSON to Typed Struct (Intermediate)

### Description
Build a JSON response parser that safely converts weakly-typed JSON data (where numbers are `float64`) into strongly-typed Go structs.

### Requirements
- Parse a JSON API response into `map[string]interface{}`
- Convert the `float64` values to appropriate Go types
- Handle missing fields, wrong types, and out-of-range values
- Build a typed `User` struct from the data

### Starter Code
```go
package main

import (
    "encoding/json"
    "fmt"
    "strconv"
)

type User struct {
    ID       int64
    Name     string
    Age      int
    Score    float64
    IsActive bool
}

// ParseUserFromJSON extracts a typed User from a JSON map
func ParseUserFromJSON(data []byte) (*User, error) {
    var raw map[string]interface{}
    if err := json.Unmarshal(data, &raw); err != nil {
        return nil, fmt.Errorf("invalid JSON: %w", err)
    }

    user := &User{}

    // TODO: Extract and convert each field
    // JSON numbers are float64 — you must convert them
    // Handle: missing fields, wrong types, invalid values

    // Hint for ID:
    // idFloat, ok := raw["id"].(float64)
    // if !ok { return nil, errors.New("missing or invalid id") }
    // user.ID = int64(idFloat)

    _ = strconv.Atoi  // may be useful
    return user, nil
}

func main() {
    input := []byte(`{
        "id": 42,
        "name": "Alice",
        "age": 30,
        "score": 98.5,
        "is_active": true
    }`)

    user, err := ParseUserFromJSON(input)
    if err != nil {
        fmt.Println("Error:", err)
        return
    }
    fmt.Printf("User: %+v\n", *user)

    // Test with bad data
    bad := []byte(`{"id": "not-a-number"}`)
    _, err = ParseUserFromJSON(bad)
    fmt.Println("Expected error:", err)
}
```

### Evaluation Criteria
- [ ] Correctly parses valid JSON into typed User struct
- [ ] Returns error for missing required fields
- [ ] Returns error when `id` is a string instead of number
- [ ] `ID` field is `int64`, not `float64`
- [ ] `IsActive` field is correctly parsed as bool

---

## Task 4: Binary Protocol Encoder (Intermediate)

### Description
Implement a simple binary protocol encoder that converts Go types to bytes for network transmission.

### Requirements
- Encode `int32`, `int64`, `float64`, `string`, `bool` to big-endian bytes
- Use pre-allocated buffers (no unnecessary allocations)
- Return the number of bytes written

### Starter Code
```go
package protocol

import (
    "encoding/binary"
    "math"
)

type Encoder struct {
    buf []byte
}

func NewEncoder(capacity int) *Encoder {
    return &Encoder{buf: make([]byte, 0, capacity)}
}

// WriteInt32 encodes an int32 as 4 bytes (big-endian)
func (e *Encoder) WriteInt32(v int32) {
    // TODO: use binary.BigEndian.AppendUint32
    // Hint: need to convert int32 to uint32 first
    panic("not implemented")
}

// WriteInt64 encodes an int64 as 8 bytes (big-endian)
func (e *Encoder) WriteInt64(v int64) {
    panic("not implemented")
}

// WriteFloat64 encodes a float64 as 8 bytes
func (e *Encoder) WriteFloat64(v float64) {
    // Hint: use math.Float64bits to get the bit pattern as uint64
    _ = math.Float64bits
    panic("not implemented")
}

// WriteString encodes a string as: 4-byte length + UTF-8 bytes
func (e *Encoder) WriteString(v string) {
    panic("not implemented")
}

// WriteBool encodes a bool as 1 byte (1=true, 0=false)
func (e *Encoder) WriteBool(v bool) {
    panic("not implemented")
}

// Bytes returns the encoded buffer
func (e *Encoder) Bytes() []byte {
    return e.buf
}
```

### Evaluation Criteria
- [ ] `WriteInt32(-1)` produces `[255, 255, 255, 255]`
- [ ] `WriteFloat64(1.0)` produces the correct IEEE 754 bytes
- [ ] `WriteString("hello")` produces `[0,0,0,5,h,e,l,l,o]`
- [ ] `WriteBool(true)` produces `[1]`
- [ ] No allocations inside Write methods (pre-allocated buffer)

---

## Task 5: Type-Safe Unit System (Intermediate)

### Description
Create a units library for physics that uses Go's type system to prevent dimension errors at compile time.

### Requirements
- Define types for Length, Mass, Time, Velocity, Acceleration, Force
- Implement arithmetic that produces correct result types
- Add String() methods for pretty printing with units

### Starter Code
```go
package units

import (
    "fmt"
    "strconv"
)

// Base SI units
type Meters float64
type Kilograms float64
type Seconds float64

// Derived units
type MetersPerSecond float64   // velocity
type MetersPerSecondSq float64 // acceleration
type Newtons float64           // force (kg⋅m/s²)

// TODO: Implement physics formulas with correct type signatures

// Velocity returns speed given distance and time
// Force compiler: you cannot pass Mass where Length is expected!
func Velocity(d Meters, t Seconds) MetersPerSecond {
    panic("not implemented")
}

// Acceleration returns acceleration given velocity change and time
func Acceleration(dv MetersPerSecond, t Seconds) MetersPerSecondSq {
    panic("not implemented")
}

// Force returns force: F = m * a (Newton's second law)
func Force(m Kilograms, a MetersPerSecondSq) Newtons {
    panic("not implemented")
}

// String methods for display
func (m Meters) String() string {
    return strconv.FormatFloat(float64(m), 'f', 2, 64) + " m"
}

func (v MetersPerSecond) String() string {
    panic("not implemented")
}

func (f Newtons) String() string {
    panic("not implemented")
}

func main() {
    distance := Meters(100)
    time := Seconds(9.58) // Usain Bolt's 100m record

    speed := Velocity(distance, time)
    fmt.Printf("Speed: %s\n", speed)  // ~10.44 m/s

    mass := Kilograms(80)
    acc := Acceleration(speed, time)
    f := Force(mass, acc)
    fmt.Printf("Force: %s\n", f)

    // This should NOT compile (type safety):
    // Velocity(time, distance)  // wrong argument order!
}
```

### Evaluation Criteria
- [ ] Compiler rejects `Velocity(time, distance)` (wrong types)
- [ ] `Velocity(100 meters, 10 seconds)` returns `10.0 m/s`
- [ ] `Force(80 kg, 9.81 m/s²)` returns approximately `784.8 N`
- [ ] String methods include correct unit labels
- [ ] All conversions between named types are explicit

---

## Task 6: CSV Parser with Type Inference (Intermediate)

### Description
Build a CSV parser that reads column headers and converts each column's data to the most appropriate Go type.

### Requirements
- Parse CSV data with a header row
- Auto-detect column types: int64, float64, bool, string
- Return a typed column map

### Starter Code
```go
package csvparse

import (
    "encoding/csv"
    "strconv"
    "strings"
)

type Column struct {
    Name   string
    Values interface{} // []int64, []float64, []bool, or []string
}

// ParseCSV parses CSV data and returns typed columns
func ParseCSV(data string) ([]Column, error) {
    r := csv.NewReader(strings.NewReader(data))

    records, err := r.ReadAll()
    if err != nil {
        return nil, err
    }
    if len(records) < 2 {
        return nil, nil
    }

    headers := records[0]
    rows := records[1:]

    columns := make([]Column, len(headers))
    for i, h := range headers {
        columns[i].Name = h
    }

    // TODO: For each column, try to parse all values as:
    // 1. int64 (using strconv.ParseInt)
    // 2. float64 (using strconv.ParseFloat)
    // 3. bool (using strconv.ParseBool)
    // 4. fallback to string
    // Set columns[i].Values to the appropriate typed slice

    _ = rows
    _ = strconv.ParseInt
    _ = strconv.ParseFloat
    _ = strconv.ParseBool

    return columns, nil
}
```

### Evaluation Criteria
- [ ] Integer columns are stored as `[]int64`
- [ ] Float columns are stored as `[]float64`
- [ ] Bool columns (true/false) are stored as `[]bool`
- [ ] Mixed/text columns fall back to `[]string`
- [ ] Headers are correctly mapped to columns

---

## Task 7: Reflection-Based Mapper (Advanced)

### Description
Build a struct-to-struct mapper using reflection that performs type conversion when field types differ but are compatible.

### Requirements
- Map fields by name between two structs
- Convert numeric types automatically
- Convert string to int/float if possible
- Skip fields that can't be converted

### Starter Code
```go
package mapper

import (
    "fmt"
    "reflect"
    "strconv"
)

// Map copies fields from src to dst, converting types where possible.
// src and dst should be pointers to structs.
func Map(src, dst interface{}) error {
    srcVal := reflect.ValueOf(src)
    dstVal := reflect.ValueOf(dst)

    // TODO: Validate that both are pointer-to-struct

    srcElem := srcVal.Elem()
    dstElem := dstVal.Elem()

    srcType := srcElem.Type()
    dstType := dstElem.Type()

    for i := 0; i < srcType.NumField(); i++ {
        srcField := srcType.Field(i)

        // Find matching field in dst by name
        dstField, ok := dstType.FieldByName(srcField.Name)
        if !ok {
            continue // skip missing fields
        }

        srcFV := srcElem.Field(i)
        dstFV := dstElem.FieldByIndex(dstField.Index)

        // TODO: Handle conversions:
        // 1. Directly convertible types (use reflect's ConvertibleTo)
        // 2. string → int (use strconv.ParseInt)
        // 3. string → float64 (use strconv.ParseFloat)
        // 4. int/float → string (use fmt.Sprintf)
        // 5. Skip if conversion not possible (log a warning)

        _ = strconv.ParseInt
        _ = fmt.Sprintf
    }

    return nil
}

// Example usage:
type Source struct {
    Name    string
    Age     string  // stored as string
    Score   int
    Active  bool
}

type Dest struct {
    Name    string
    Age     int     // needs string→int conversion
    Score   float64 // needs int→float64 conversion
    Active  bool
}
```

### Evaluation Criteria
- [ ] Fields with identical types are copied directly
- [ ] String "42" is converted to `int` 42 when destination is int
- [ ] `int(100)` is converted to `float64(100.0)`
- [ ] Unconvertible fields are skipped without error
- [ ] Function panics with clear message for non-struct inputs

---

## Task 8: Zero-Allocation String Processor (Advanced)

### Description
Implement a high-performance string processor that finds and replaces patterns without allocating intermediate strings or byte slices.

### Requirements
- Process a string byte by byte without converting to `[]byte`
- Use `strings.Builder` for output
- Achieve zero extra allocations beyond the output string
- Benchmark your solution

### Starter Code
```go
package strproc

import (
    "strings"
    "testing"
)

// ReplaceDigits replaces each digit in s with its spelled-out form
// e.g., "a1b2" → "aonebtwob"
// Must not allocate intermediate []byte
func ReplaceDigits(s string) string {
    // Hint: iterate over s directly (s[i] gives byte)
    // Use strings.Builder for output
    // Do NOT use []byte(s) conversion

    var b strings.Builder
    b.Grow(len(s) * 2) // pre-allocate

    // TODO: implement
    panic("not implemented")
}

var digitWords = [10]string{
    "zero", "one", "two", "three", "four",
    "five", "six", "seven", "eight", "nine",
}

// Benchmark your solution
func BenchmarkReplaceDigits(b *testing.B) {
    input := "abc123def456ghi789"
    for i := 0; i < b.N; i++ {
        _ = ReplaceDigits(input)
    }
}

// CountRuneTypes counts letters, digits, spaces, and other characters
// without converting s to []byte or []rune
func CountRuneTypes(s string) (letters, digits, spaces, other int) {
    // Hint: use for _, r := range s (iterates runes without conversion)
    panic("not implemented")
}
```

### Evaluation Criteria
- [ ] `ReplaceDigits("a1b2")` returns `"aonebtwob"`
- [ ] `ReplaceDigits("123")` returns `"onetwothree"`
- [ ] No `[]byte(s)` conversion used
- [ ] `CountRuneTypes` correctly handles Unicode (multi-byte chars)
- [ ] Benchmark shows 0 allocations per `ReplaceDigits` call (other than the returned string)

---

## Task 9: Config Validator with Typed Constraints (Advanced)

### Description
Build a configuration validation system where each config field has a typed range constraint.

### Requirements
- Define typed config fields with min/max constraints
- Parse environment variables and validate against constraints
- Return all validation errors at once (not fail-fast)
- Support `int`, `float64`, `bool`, `string` field types

### Starter Code
```go
package config

import (
    "errors"
    "fmt"
    "os"
    "strconv"
)

type FieldType int
const (
    TypeInt FieldType = iota
    TypeFloat
    TypeBool
    TypeString
)

type FieldSpec struct {
    EnvVar   string
    Type     FieldType
    Required bool
    Min      float64 // used for TypeInt and TypeFloat
    Max      float64 // used for TypeInt and TypeFloat
    Default  string  // string representation of default value
}

type ConfigValue struct {
    IntVal    int
    FloatVal  float64
    BoolVal   bool
    StringVal string
    IsSet     bool
}

// ParseConfig reads environment variables based on specs and returns typed values.
func ParseConfig(specs map[string]FieldSpec) (map[string]ConfigValue, error) {
    results := make(map[string]ConfigValue)
    var errs []error

    for name, spec := range specs {
        raw := os.Getenv(spec.EnvVar)
        if raw == "" {
            if spec.Required {
                errs = append(errs, fmt.Errorf("required env var %s is not set", spec.EnvVar))
                continue
            }
            raw = spec.Default
            if raw == "" {
                continue
            }
        }

        var val ConfigValue
        val.IsSet = true

        switch spec.Type {
        case TypeInt:
            // TODO: parse and validate int within [Min, Max]
            _ = strconv.Atoi
        case TypeFloat:
            // TODO: parse and validate float within [Min, Max]
            _ = strconv.ParseFloat
        case TypeBool:
            // TODO: parse bool
            _ = strconv.ParseBool
        case TypeString:
            val.StringVal = raw
        }

        results[name] = val
    }

    return results, errors.Join(errs...)
}
```

### Evaluation Criteria
- [ ] Required fields with missing env vars produce errors
- [ ] Integer values outside [Min, Max] produce errors
- [ ] Float values outside [Min, Max] produce errors
- [ ] All errors are collected before returning (not fail-fast)
- [ ] Default values are used when env var is not set
- [ ] Bool parsing accepts "true", "false", "1", "0"

---

## Task 10: Generic Conversion Pipeline (Advanced, Go 1.18+)

### Description
Build a type-safe data processing pipeline using generics that can chain conversion operations.

### Requirements
- Define a `Pipeline[T, U]` type that converts `[]T` to `[]U`
- Support chaining: `Pipeline[T, U]` → `Pipeline[U, V]`
- Handle errors in the conversion function
- Include a filtering step

### Starter Code
```go
package pipeline

import "fmt"

// Converter is a function that converts T to U (may fail)
type Converter[T, U any] func(T) (U, error)

// Pipeline converts a slice of T to a slice of U
type Pipeline[T, U any] struct {
    converter Converter[T, U]
}

// NewPipeline creates a pipeline with the given converter
func NewPipeline[T, U any](conv Converter[T, U]) *Pipeline[T, U] {
    return &Pipeline[T, U]{converter: conv}
}

// Run applies the converter to all items, collecting successes and errors
func (p *Pipeline[T, U]) Run(inputs []T) (results []U, errs []error) {
    // TODO: apply p.converter to each input
    // Collect successes in results, errors in errs
    panic("not implemented")
}

// Chain creates a new pipeline that applies p first, then next
func Chain[T, U, V any](p *Pipeline[T, U], next *Pipeline[U, V]) *Pipeline[T, V] {
    return NewPipeline(func(input T) (V, error) {
        // TODO: apply p.converter, then next.converter
        panic("not implemented")
    })
}

// Filter creates a pipeline that only passes items matching the predicate
func Filter[T any](pred func(T) bool) *Pipeline[T, T] {
    return NewPipeline(func(input T) (T, error) {
        if !pred(input) {
            return input, fmt.Errorf("filtered out")
        }
        return input, nil
    })
}

// Example usage:
func ExampleUsage() {
    // String → int → float64 pipeline
    parseInts := NewPipeline(func(s string) (int, error) {
        // TODO: use strconv.Atoi
        panic("not implemented")
    })

    toFloat := NewPipeline(func(n int) (float64, error) {
        return float64(n), nil
    })

    pipeline := Chain(parseInts, toFloat)

    inputs := []string{"1", "2", "abc", "4", "5"}
    results, errs := pipeline.Run(inputs)

    fmt.Println("Results:", results) // [1, 2, 4, 5]
    fmt.Println("Errors:", len(errs)) // 1 (for "abc")
}
```

### Evaluation Criteria
- [ ] `Run` applies converter to all items and separates results from errors
- [ ] `Chain` correctly pipes output of first pipeline to input of second
- [ ] `Filter` removes items that don't match the predicate
- [ ] The pipeline is truly generic (works with any type pair)
- [ ] Type inference works at call sites (no explicit type parameters needed)
- [ ] Error items are skipped but don't stop processing other items

---

## Task 11: HTTP Parameter Binder (Advanced)

### Description
Build an HTTP request parameter binder that automatically converts URL query parameters and form fields to typed struct fields using struct tags.

### Starter Code
```go
package binder

import (
    "fmt"
    "net/http"
    "reflect"
    "strconv"
    "strings"
)

// Bind parses HTTP request parameters into a struct.
// Uses struct tags: `form:"fieldname"`
//
// Example:
//   type SearchRequest struct {
//       Query  string `form:"q"`
//       Page   int    `form:"page"`
//       Limit  int    `form:"limit"`
//       Active bool   `form:"active"`
//   }
func Bind(r *http.Request, dst interface{}) error {
    if err := r.ParseForm(); err != nil {
        return fmt.Errorf("parse form: %w", err)
    }

    dstVal := reflect.ValueOf(dst)
    if dstVal.Kind() != reflect.Ptr || dstVal.Elem().Kind() != reflect.Struct {
        return fmt.Errorf("dst must be pointer to struct")
    }

    dstElem := dstVal.Elem()
    dstType := dstElem.Type()

    for i := 0; i < dstType.NumField(); i++ {
        field := dstType.Field(i)
        tag := field.Tag.Get("form")
        if tag == "" || tag == "-" {
            continue
        }

        // Parse tag (may have options: "name,omitempty")
        parts := strings.Split(tag, ",")
        paramName := parts[0]

        paramVal := r.FormValue(paramName)
        if paramVal == "" {
            continue
        }

        fieldVal := dstElem.Field(i)

        // TODO: convert paramVal (string) to the field's type
        // Handle: string, int, int64, float64, bool
        // Use strconv functions

        _ = strconv.Atoi
        _ = fieldVal
    }

    return nil
}
```

### Evaluation Criteria
- [ ] String fields are set directly
- [ ] Int fields are parsed from string using strconv
- [ ] Bool fields accept "true", "false", "1", "0"
- [ ] Invalid conversion returns descriptive error
- [ ] Fields without `form` tag are skipped
- [ ] Works with nested URL query parameters

---

## Tips for All Tasks

1. **Always check errors from strconv functions** — never use `_` to discard parse errors
2. **Use `strconv.ParseInt` with bitSize** to automatically validate range
3. **Define named types** when distinct concepts share the same underlying type
4. **Write tests first** (TDD) — define expected inputs/outputs before implementing
5. **Benchmark** tasks 8 and 10 to verify your allocation claims
6. **Use `go vet ./...`** to catch common conversion mistakes
