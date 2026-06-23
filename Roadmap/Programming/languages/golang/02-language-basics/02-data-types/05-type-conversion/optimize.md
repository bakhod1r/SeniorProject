# Type Conversion in Go — Optimization Exercises

Each exercise presents working code that has performance issues. Optimize it!

---

## Exercise 1 🟢 — Replace fmt.Sprintf with strconv

**Original code:** (works correctly but is slow)

```go
package main

import (
    "fmt"
    "strings"
)

func formatNumbers(nums []int) string {
    parts := make([]string, len(nums))
    for i, n := range nums {
        parts[i] = fmt.Sprintf("%d", n)  // SLOW: 200ns per call
    }
    return strings.Join(parts, ", ")
}
```

**Task:** Replace `fmt.Sprintf` with `strconv.Itoa` and measure the improvement.

<details>
<summary>Solution</summary>

```go
package main

import (
    "strconv"
    "strings"
)

func formatNumbers(nums []int) string {
    parts := make([]string, len(nums))
    for i, n := range nums {
        parts[i] = strconv.Itoa(n)  // ~7x faster than fmt.Sprintf
    }
    return strings.Join(parts, ", ")
}
```

**Expected improvement:**
```
BenchmarkFormatNumbers (fmt.Sprintf): ~200 ns/op, 2 allocs/op
BenchmarkFormatNumbers (strconv.Itoa): ~30 ns/op, 1 alloc/op
```

**Why it's faster:** `strconv.Itoa` is a direct integer-to-string conversion using a stack-allocated lookup table. `fmt.Sprintf` uses reflection and a format parser, adding significant overhead.
</details>

---

## Exercise 2 🟢 — Avoid Repeated String-to-Bytes Conversion

**Original code:**

```go
package main

import "bytes"

// countOccurrences counts how many times 'word' appears in 'text'
func countOccurrences(text, word string) int {
    count := 0
    for {
        idx := bytes.Index([]byte(text), []byte(word))  // converts EVERY iteration!
        if idx == -1 {
            break
        }
        text = text[idx+len(word):]
        count++
    }
    return count
}
```

**Task:** Eliminate the repeated `[]byte()` conversions. The function should produce identical results.

<details>
<summary>Solution</summary>

```go
package main

import "strings"

// Option 1: Use strings package (no conversion at all!)
func countOccurrences(text, word string) int {
    return strings.Count(text, word)
}

// Option 2: Convert once if you need bytes
func countOccurrencesManual(text, word string) int {
    if len(word) == 0 {
        return 0
    }
    textBytes := []byte(text)  // convert ONCE
    wordBytes := []byte(word)  // convert ONCE

    count := 0
    start := 0
    for start <= len(textBytes)-len(wordBytes) {
        idx := bytes.Index(textBytes[start:], wordBytes)
        if idx == -1 {
            break
        }
        start += idx + len(wordBytes)
        count++
    }
    return count
}
```

**Why it's faster:** The original converts `text` and `word` to `[]byte` on every iteration — O(n*m) allocations. Converting once reduces allocations to O(1), and using `strings.Count` avoids allocations entirely.
</details>

---

## Exercise 3 🟢 — Use strconv.AppendInt Instead of Itoa+Concatenation

**Original code:**

```go
package main

import (
    "strconv"
    "strings"
)

type LogLine struct {
    Level   string
    Code    int
    Message string
}

func formatLogLine(l LogLine) string {
    return l.Level + " [" + strconv.Itoa(l.Code) + "] " + l.Message
    // Each + allocates a new string!
}
```

**Task:** Rewrite using `strings.Builder` and `strconv.AppendInt` to reduce allocations.

<details>
<summary>Solution</summary>

```go
package main

import (
    "strconv"
    "strings"
)

func formatLogLine(l LogLine) string {
    var b strings.Builder
    // Pre-allocate enough space to avoid resizing
    b.Grow(len(l.Level) + 5 + 10 + 2 + len(l.Message))

    b.WriteString(l.Level)
    b.WriteString(" [")
    buf := strconv.AppendInt([]byte{}, int64(l.Code), 10)
    b.Write(buf)
    b.WriteString("] ")
    b.WriteString(l.Message)

    return b.String()
}
```

**Improvement:** Original: 4-5 allocations per call. Optimized: 1-2 allocations.
</details>

---

## Exercise 4 🟡 — Pool Byte Slice Buffers

**Original code:**

```go
package main

import (
    "encoding/json"
    "net/http"
)

type Response struct {
    Status  int    `json:"status"`
    Message string `json:"message"`
}

// writeJSON is called on every HTTP request
func writeJSON(w http.ResponseWriter, resp Response) error {
    data, err := json.Marshal(resp)  // allocates new []byte every request
    if err != nil {
        return err
    }
    w.Header().Set("Content-Type", "application/json")
    w.Write(data)
    return nil
}
```

**Task:** Use `sync.Pool` with a `bytes.Buffer` to reduce per-request allocations.

<details>
<summary>Solution</summary>

```go
package main

import (
    "bytes"
    "encoding/json"
    "net/http"
    "strconv"
    "sync"
)

var bufPool = sync.Pool{
    New: func() interface{} {
        return new(bytes.Buffer)
    },
}

func writeJSON(w http.ResponseWriter, resp Response) error {
    buf := bufPool.Get().(*bytes.Buffer)
    buf.Reset()
    defer bufPool.Put(buf)

    if err := json.NewEncoder(buf).Encode(resp); err != nil {
        return err
    }

    w.Header().Set("Content-Type", "application/json")
    w.Header().Set("Content-Length", strconv.Itoa(buf.Len()))
    _, err := w.Write(buf.Bytes())
    return err
}
```

**Why it's faster:** `sync.Pool` reuses buffers across requests, dramatically reducing GC pressure in high-throughput scenarios.
</details>

---

## Exercise 5 🟡 — Zero-Copy String Comparison

**Original code:**

```go
package main

import "strings"

// isValidMethod checks if the HTTP method is one of the allowed methods
func isValidMethod(method string) bool {
    allowed := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"}
    for _, m := range allowed {
        if strings.ToUpper(method) == m {  // allocates on every comparison!
            return true
        }
    }
    return false
}
```

**Task:** Eliminate the allocation inside the loop. The function must still be case-insensitive.

<details>
<summary>Solution</summary>

```go
package main

import "strings"

// Option 1: Convert once, use switch
func isValidMethod(method string) bool {
    upper := strings.ToUpper(method)  // allocate once
    switch upper {
    case "GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD":
        return true
    }
    return false
}

// Option 2: Use strings.EqualFold for case-insensitive comparison without ToUpper
func isValidMethodV2(method string) bool {
    allowed := []string{"GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"}
    for _, m := range allowed {
        if strings.EqualFold(method, m) {  // no allocation!
            return true
        }
    }
    return false
}
```

**Key insight:** `strings.EqualFold` does case-insensitive comparison without allocating a new string. `strings.ToUpper` allocates inside the loop multiplies allocations.
</details>

---

## Exercise 6 🟡 — Avoid []byte(string) in Hot Path

**Original code:**

```go
package main

import "net/http"

var healthOKResponse = "OK"

func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(healthOKResponse))  // allocates every request!
}
```

**Task:** Pre-allocate the byte slices as package-level variables to eliminate per-request allocations.

<details>
<summary>Solution</summary>

```go
package main

import "net/http"

// Pre-allocate response bodies as []byte at package level
var healthOKBytes = []byte("OK")

func healthCheckHandler(w http.ResponseWriter, r *http.Request) {
    w.WriteHeader(http.StatusOK)
    w.Write(healthOKBytes)  // no allocation!
}
```

**Why it's faster:** Package-level `[]byte` variables are allocated once at startup. `w.Write([]byte(s))` allocated a new slice on every call. Pre-allocated slices are safe because `http.ResponseWriter.Write` does not modify the slice after the call returns.
</details>

---

## Exercise 7 🟡 — Efficient Integer Formatting in Hot Loop

**Original code:**

```go
package main

import (
    "fmt"
    "strings"
)

// generateCSVRow converts a row of integers to a CSV line
func generateCSVRow(values []int) string {
    parts := make([]string, len(values))
    for i, v := range values {
        parts[i] = fmt.Sprintf("%d", v)
    }
    return strings.Join(parts, ",") + "\n"
}
```

**Task:** Rewrite to minimize allocations. Target: 1 allocation per call (for the returned string).

<details>
<summary>Solution</summary>

```go
package main

import "strconv"

func generateCSVRow(values []int) string {
    if len(values) == 0 {
        return "\n"
    }

    // Single pre-allocated buffer
    buf := make([]byte, 0, len(values)*5+1)
    for i, v := range values {
        if i > 0 {
            buf = append(buf, ',')
        }
        buf = strconv.AppendInt(buf, int64(v), 10)
    }
    buf = append(buf, '\n')

    return string(buf)  // single allocation
}
```

**Expected improvement:**
```
Original:  ~500 ns/op, 12 allocs/op (for 10 values)
Optimized: ~120 ns/op, 1 alloc/op
```
</details>

---

## Exercise 8 🔴 — Eliminate string→[]byte in Serializer

**Original code:**

```go
package main

import "strconv"

type Serializer struct{}

func (s Serializer) SerializeInt(n int64) []byte {
    str := strconv.FormatInt(n, 10)  // int64 → string
    return []byte(str)               // string → []byte (two allocations!)
}

func (s Serializer) SerializeFloat(f float64) []byte {
    str := strconv.FormatFloat(f, 'f', -1, 64)
    return []byte(str)
}
```

**Task:** Refactor to accept a `[]byte` output buffer and use `strconv.Append*` functions to avoid intermediate allocations entirely.

<details>
<summary>Solution</summary>

```go
package main

import "strconv"

type Serializer struct{}

// AppendInt writes the integer to buf and returns the extended slice
func (s Serializer) AppendInt(buf []byte, n int64) []byte {
    return strconv.AppendInt(buf, n, 10)  // writes directly to buf, zero alloc!
}

func (s Serializer) AppendFloat(buf []byte, f float64) []byte {
    return strconv.AppendFloat(buf, f, 'f', -1, 64)
}

func (s Serializer) AppendBool(buf []byte, b bool) []byte {
    return strconv.AppendBool(buf, b)
}

// Usage: caller provides the buffer
func ExampleUsage() {
    s := Serializer{}
    buf := make([]byte, 0, 256)  // pre-allocate, caller owns

    buf = s.AppendInt(buf, 42)
    buf = append(buf, ',')
    buf = s.AppendFloat(buf, 3.14)
    buf = append(buf, ',')
    buf = s.AppendBool(buf, true)

    // buf contains serialized data, zero intermediate allocations
    _ = buf
}
```

**Improvement:** Original: 2 allocations per value. Optimized: 0 allocations per value (caller provides buffer).

**Pattern:** The `Append*` pattern is used throughout Go's standard library (`strconv.AppendInt`, `time.Time.AppendFormat`, etc.) specifically to enable zero-allocation serialization.
</details>

---

## Exercise 9 🔴 — Optimize Type Switch in Hot Path

**Original code:**

```go
package main

import (
    "fmt"
    "strconv"
)

// normalize converts any value to its canonical string form
// Called >100,000 times/second in a metrics aggregator
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
    default:
        return fmt.Sprintf("%v", val)
    }
}
```

**Task 1:** Reorder the switch for most common types first (assume float64 is most common in this metrics system).

**Task 2:** Provide an `AppendNormalize(buf []byte, v interface{}) []byte` variant that avoids string allocation.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "strconv"
)

// Reordered: most common types in metrics (float64, string, int64) first
func normalize(v interface{}) string {
    switch val := v.(type) {
    case float64:  // most common in JSON/metrics
        return strconv.FormatFloat(val, 'f', -1, 64)
    case string:   // second most common
        return val
    case int64:    // common for counters
        return strconv.FormatInt(val, 10)
    case int:
        return strconv.Itoa(val)
    case bool:
        return strconv.FormatBool(val)
    default:
        return fmt.Sprintf("%v", val)
    }
}

// Zero-allocation variant: writes to caller-provided buffer
func AppendNormalize(buf []byte, v interface{}) []byte {
    switch val := v.(type) {
    case float64:
        return strconv.AppendFloat(buf, val, 'f', -1, 64)
    case string:
        return append(buf, val...)
    case int64:
        return strconv.AppendInt(buf, val, 10)
    case int:
        return strconv.AppendInt(buf, int64(val), 10)
    case bool:
        return strconv.AppendBool(buf, val)
    default:
        return fmt.Appendf(buf, "%v", val)
    }
}
```

**Key insight:** Type switch cases are checked in order. Putting the most common types first reduces average match time. The `Append*` variant eliminates all intermediate string allocations.
</details>

---

## Exercise 10 🔴 — Batch Numeric String Parsing

**Original code:**

```go
package main

import (
    "strconv"
    "strings"
)

// ParseIntSlice parses a comma-separated string of integers
// e.g., "1,2,3,4,5" -> []int{1,2,3,4,5}
func ParseIntSlice(s string) ([]int, error) {
    if s == "" {
        return nil, nil
    }
    parts := strings.Split(s, ",")  // allocates []string with n strings
    result := make([]int, 0, len(parts))
    for _, p := range parts {
        n, err := strconv.Atoi(strings.TrimSpace(p))  // TrimSpace allocates
        if err != nil {
            return nil, err
        }
        result = append(result, n)
    }
    return result, nil
}
```

**Task:** Rewrite using manual string scanning to avoid `strings.Split` allocation and minimize `TrimSpace` allocations.

<details>
<summary>Solution</summary>

```go
package main

import (
    "fmt"
    "strconv"
)

// ParseIntSlice parses without intermediate []string allocation
func ParseIntSlice(s string) ([]int, error) {
    if s == "" {
        return nil, nil
    }

    // Count commas to pre-allocate result slice
    count := 1
    for _, c := range s {
        if c == ',' {
            count++
        }
    }

    result := make([]int, 0, count)
    start := 0

    for i := 0; i <= len(s); i++ {
        if i == len(s) || s[i] == ',' {
            // Extract token without allocation (substring shares memory)
            token := s[start:i]

            // Trim spaces manually (no allocation)
            for len(token) > 0 && token[0] == ' ' {
                token = token[1:]
            }
            for len(token) > 0 && token[len(token)-1] == ' ' {
                token = token[:len(token)-1]
            }

            if len(token) == 0 {
                return nil, fmt.Errorf("empty token at position %d", i)
            }

            n, err := strconv.Atoi(token)
            if err != nil {
                return nil, fmt.Errorf("invalid integer %q: %w", token, err)
            }
            result = append(result, n)
            start = i + 1
        }
    }

    return result, nil
}
```

**Why it's faster:**
1. No `strings.Split` — no intermediate `[]string` allocation
2. Substring slicing `s[start:i]` shares memory with the original string — no allocation
3. Manual space trimming — no `strings.TrimSpace` allocation

**Expected improvement:**
```
Original:   ~400 ns/op  for "1,2,3,4,5"   5 allocs/op
Optimized:  ~200 ns/op  for "1,2,3,4,5"   1 alloc/op (result slice only)
```
</details>

---

## Exercise 11 🔴 — Minimize Interface{} Type Assertions in Loop

**Original code:**

```go
package main

import "fmt"

type Event struct {
    Type    string
    Payload interface{}
}

// processEvents processes a batch of events
func processEvents(events []Event) []string {
    results := make([]string, 0, len(events))
    for _, e := range events {
        switch e.Type {
        case "user.login":
            if payload, ok := e.Payload.(map[string]string); ok {
                results = append(results, payload["username"])
            }
        case "item.view":
            if payload, ok := e.Payload.(map[string]int); ok {
                results = append(results, fmt.Sprintf("item:%d", payload["id"]))
            }
        }
    }
    return results
}
```

**Task:** Redesign to avoid interface{} and type assertions using typed event structs.

<details>
<summary>Solution</summary>

```go
package main

import "strconv"

// Typed event payloads — no interface{} needed
type LoginPayload struct {
    Username string
    IP       string
}

type ItemViewPayload struct {
    ID     int
    UserID int
}

// Typed event processing — no type assertions!
func processLoginEvents(events []LoginPayload) []string {
    results := make([]string, len(events))
    for i, e := range events {
        results[i] = e.Username  // direct field access, no assertion
    }
    return results
}

func processItemViewEvents(events []ItemViewPayload) []string {
    results := make([]string, len(events))
    for i, e := range events {
        results[i] = "item:" + strconv.Itoa(e.ID)  // no assertion, no fmt.Sprintf
    }
    return results
}
```

**Why it's faster:**
1. Typed event structs eliminate runtime type assertions entirely
2. Direct struct field access is faster than map lookups + type assertion
3. `strconv.Itoa` is faster than `fmt.Sprintf` for single integer formatting
4. Compiler can inline typed struct accesses
</details>

---

## Benchmarking Guide

To benchmark your optimizations:

```bash
# Run all benchmarks in the current package
go test -bench=. -benchmem ./...

# Run specific benchmark
go test -bench=BenchmarkFormatNumbers -benchmem -count=5

# Compare before and after using benchstat
go install golang.org/x/perf/cmd/benchstat@latest
go test -bench=. -benchmem -count=10 > before.txt
# make changes
go test -bench=. -benchmem -count=10 > after.txt
benchstat before.txt after.txt

# Profile allocations
go test -bench=. -memprofile=mem.prof
go tool pprof mem.prof
```

## Summary: Optimization Techniques

| Technique | When to Use | Benefit |
|-----------|------------|---------|
| `strconv.Itoa` over `fmt.Sprintf` | Single int to string | 7x faster |
| `strconv.Append*` functions | Building output buffers | 0 allocs |
| Pre-allocate package-level `[]byte` | Constant byte slices | 0 allocs per use |
| `strings.Builder` with `Grow` | Building strings | Fewer resizes |
| `sync.Pool` for buffers | High-throughput servers | Reduces GC pressure |
| Convert `[]byte(s)` once outside loop | Repeated comparisons | O(n) to O(1) allocs |
| `strings.EqualFold` over `ToUpper` | Case-insensitive compare | 0 allocs |
| `unsafe.Slice(unsafe.StringData(s), n)` | Read-only byte access | 0 allocs (unsafe!) |
| Typed structs over `interface{}` | Homogeneous data | Eliminates assertions |
| Manual string scanning over `strings.Split` | CSV/list parsing | Fewer allocs |
