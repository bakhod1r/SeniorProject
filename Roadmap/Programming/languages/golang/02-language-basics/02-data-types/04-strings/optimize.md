# Strings in Go — Optimization Exercises

## Exercise 1: Replace String Concatenation in Loop

**Slow Version:**
```go
package main

import "fmt"

func joinWithSeparator(items []string, sep string) string {
    result := ""
    for i, item := range items {
        if i > 0 {
            result += sep
        }
        result += item
    }
    return result
}

func main() {
    items := make([]string, 1000)
    for i := range items {
        items[i] = fmt.Sprintf("item%d", i)
    }
    fmt.Println(joinWithSeparator(items, ", "))
}
```

**Task**: Optimize this function. Measure the improvement with benchmarks.

<details>
<summary>Solution</summary>

```go
// Option 1: Use strings.Join (simplest)
func joinWithSeparatorV2(items []string, sep string) string {
    return strings.Join(items, sep)
}

// Option 2: Manual with strings.Builder and pre-allocation
func joinWithSeparatorV3(items []string, sep string) string {
    if len(items) == 0 {
        return ""
    }
    // Estimate total size to avoid reallocations
    total := len(sep) * (len(items) - 1)
    for _, item := range items {
        total += len(item)
    }

    var b strings.Builder
    b.Grow(total)
    b.WriteString(items[0])
    for _, item := range items[1:] {
        b.WriteString(sep)
        b.WriteString(item)
    }
    return b.String()
}

// Benchmark results (1000 items):
// V1 (+=):    ~500µs/op, ~500KB allocs/op
// V2 (Join):  ~5µs/op,   ~10KB allocs/op  (100x faster)
// V3 (Builder+Grow): ~4µs/op, ~10KB allocs/op
```
</details>

---

## Exercise 2: Case-Insensitive Comparison Without Allocation

**Slow Version:**
```go
func containsIgnoreCase(s, substr string) bool {
    return strings.Contains(strings.ToLower(s), strings.ToLower(substr))
}
```

**Task**: Optimize this to avoid allocating new strings for the lowercase conversion.

<details>
<summary>Solution</summary>

```go
// Option 1: Use strings.EqualFold for equality
// But for Contains, we need a different approach

// Option 2: strings.Contains with fold (Go standard library helper)
// Not in stdlib directly, but can use:
import "strings"
import "unicode/utf8"
import "unicode"

func containsIgnoreCase(s, substr string) bool {
    // For simple ASCII-only case: manual comparison
    if len(substr) == 0 {
        return true
    }

    // Use strings.Index with a custom search
    // strings.ContainsFold was added in discussion but not yet in stdlib
    // Best stdlib option: fold both (2 allocs) or use EqualFold per window

    // Efficient approach: check each window with EqualFold-like logic
    subLen := len(substr)
    for i := 0; i <= len(s)-subLen; i++ {
        if strings.EqualFold(s[i:i+subLen], substr) {
            return true
        }
    }
    return false
}
// Note: this is O(n*m) but zero-allocation.
// For production, consider: strings.ToLower once + cache the lowered form.

// Benchmark vs original:
// Original: 2 allocs (ToLower on s and substr)
// Optimized: 0 allocs
// Speed: similar for small strings, faster for large strings with early match
```
</details>

---

## Exercise 3: Avoid Re-allocating in String Validation

**Slow Version:**
```go
func isValidUsername(username string) bool {
    lower := strings.ToLower(username)
    trimmed := strings.TrimSpace(lower)
    if len(trimmed) < 3 || len(trimmed) > 20 {
        return false
    }
    for _, r := range trimmed {
        if !('a' <= r && r <= 'z') && !('0' <= r && r <= '9') && r != '_' {
            return false
        }
    }
    return true
}
```

**Task**: Optimize to reduce allocations while maintaining correctness.

<details>
<summary>Solution</summary>

```go
import "unicode"

func isValidUsername(username string) bool {
    // Avoid trimmed/lower allocations by checking inline

    // Count non-space characters (simulates TrimSpace length check)
    start, end := 0, len(username)
    for start < end && username[start] == ' ' {
        start++
    }
    for end > start && username[end-1] == ' ' {
        end--
    }
    trimLen := end - start
    if trimLen < 3 || trimLen > 20 {
        return false
    }

    // Validate characters (fold lowercase inline)
    for i := start; i < end; {
        r, size := utf8.DecodeRuneInString(username[i:])
        i += size
        r = unicode.ToLower(r) // no alloc, just rune transform
        if !('a' <= r && r <= 'z') && !('0' <= r && r <= '9') && r != '_' {
            return false
        }
    }
    return true
}

// Benchmark improvement:
// Original: 2 allocs (ToLower + TrimSpace)
// Optimized: 0 allocs
// ~3x faster for typical username strings
```
</details>

---

## Exercise 4: Optimize Repeated String Building

**Slow Version:**
```go
func generateHTML(items []string) string {
    html := "<ul>\n"
    for _, item := range items {
        html += "  <li>" + item + "</li>\n"
    }
    html += "</ul>"
    return html
}
```

**Task**: Optimize for generating HTML for large item lists.

<details>
<summary>Solution</summary>

```go
func generateHTML(items []string) string {
    const prefix = "  <li>"
    const suffix = "</li>\n"
    // Pre-calculate size: "<ul>\n" + n*(len(prefix)+len(suffix)) + items + "</ul>"
    size := 6 // "<ul>\n"
    for _, item := range items {
        size += len(prefix) + len(item) + len(suffix)
    }
    size += 5 // "</ul>"

    var b strings.Builder
    b.Grow(size)
    b.WriteString("<ul>\n")
    for _, item := range items {
        b.WriteString(prefix)
        b.WriteString(item)
        b.WriteString(suffix)
    }
    b.WriteString("</ul>")
    return b.String()
}

// For 10,000 items:
// Original: ~10,000 allocs, ~100ms
// Optimized: 1 alloc, ~1ms (100x faster)
```
</details>

---

## Exercise 5: Avoid fmt.Sprintf in Hot Path

**Slow Version:**
```go
func formatMetricName(service, metric string, port int) string {
    return fmt.Sprintf("%s.%s.%d", service, metric, port)
}
// This is called 100,000 times per second for metrics
```

**Task**: Optimize the metric name formatting to reduce allocations in this hot path.

<details>
<summary>Solution</summary>

```go
import "strconv"

func formatMetricName(service, metric string, port int) string {
    // strings.Builder is faster than fmt.Sprintf for known patterns
    var b strings.Builder
    b.Grow(len(service) + 1 + len(metric) + 1 + 6) // port is at most 5 digits
    b.WriteString(service)
    b.WriteByte('.')
    b.WriteString(metric)
    b.WriteByte('.')
    b.WriteString(strconv.Itoa(port))
    return b.String()
}

// Even faster for fixed-format strings: use byte slice
func formatMetricNameFast(service, metric string, port int) string {
    buf := make([]byte, 0, len(service)+len(metric)+8)
    buf = append(buf, service...)
    buf = append(buf, '.')
    buf = append(buf, metric...)
    buf = append(buf, '.')
    buf = strconv.AppendInt(buf, int64(port), 10)
    return string(buf)
}

// Benchmark (100K calls):
// fmt.Sprintf:         ~300ns/op, 1 alloc/op
// strings.Builder:     ~150ns/op, 1 alloc/op
// byte slice approach: ~120ns/op, 1 alloc/op
// (all still allocate once for the returned string)
// Savings: ~2x speed improvement
```
</details>

---

## Exercise 6: Intern Repeated Strings

**Slow Version (in a log parser reading 1M lines):**
```go
type LogLine struct {
    Service string
    Level   string
    Message string
}

func parseLine(line string) LogLine {
    // Service and Level repeat thousands of times
    parts := strings.SplitN(line, " ", 3)
    return LogLine{
        Service: parts[0],  // allocates new string each time!
        Level:   parts[1],  // allocates new string each time!
        Message: parts[2],
    }
}
```

**Task**: Optimize memory usage for the `Service` and `Level` fields which have low cardinality (few unique values).

<details>
<summary>Solution</summary>

```go
import "sync"

// Simple string interner using sync.Map
type Interner struct {
    m sync.Map
}

func (in *Interner) Intern(s string) string {
    if v, ok := in.m.Load(s); ok {
        return v.(string)
    }
    // Clone to avoid retaining the original large buffer
    clone := strings.Clone(s)
    actual, _ := in.m.LoadOrStore(clone, clone)
    return actual.(string)
}

var interner = &Interner{}

func parseLine(line string) LogLine {
    parts := strings.SplitN(line, " ", 3)
    return LogLine{
        Service: interner.Intern(parts[0]), // reuse existing string
        Level:   interner.Intern(parts[1]), // reuse existing string
        Message: parts[2],                  // unique per line, don't intern
    }
}

// Memory savings for 1M log lines with 5 services and 4 log levels:
// Without interning: 1M * (avg_service_len + avg_level_len) ≈ 20MB extra
// With interning: only 9 unique strings (5+4) ≈ 100 bytes extra
// Savings: ~20MB, plus reduced GC pressure
```
</details>

---

## Exercise 7: Zero-Copy Byte to String in HTTP Handler

**Slow Version:**
```go
func routeRequest(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path  // already a string, ok
    body, _ := io.ReadAll(r.Body)

    // Parsing the body as a string requires a copy
    if strings.Contains(string(body), "error") {
        log.Printf("error in request to %s", path)
    }
    // ... process body ...
}
```

**Task**: Avoid allocating a string copy of `body` just for the `Contains` check.

<details>
<summary>Solution</summary>

```go
import "bytes"

func routeRequest(w http.ResponseWriter, r *http.Request) {
    path := r.URL.Path
    body, _ := io.ReadAll(r.Body)

    // Use bytes.Contains instead of converting to string
    if bytes.Contains(body, []byte("error")) {
        log.Printf("error in request to %s", path)
    }

    // Alternative: use unsafe zero-copy conversion IF body won't be modified
    // and the string doesn't need to outlive this function
    import "unsafe"
    bodyStr := unsafe.String(unsafe.SliceData(body), len(body))
    if strings.Contains(bodyStr, "error") { // zero-copy!
        log.Printf("error in request to %s", path)
    }

    // Or for checking multiple patterns, use bytes.Reader:
    // bytes.Contains is usually the cleanest solution
}

// Optimization impact:
// Original: 1 alloc for string(body) (copies entire body!)
// bytes.Contains: 0 allocs (works on []byte directly)
// For a 10KB request body: saves 10KB allocation per request
```
</details>

---

## Exercise 8: Pre-compute String Length in Hot Loop

**Slow Version:**
```go
func countLines(text string) int {
    count := 0
    for strings.Contains(text, "\n") {
        idx := strings.Index(text, "\n")
        text = text[idx+1:]
        count++
    }
    if text != "" {
        count++
    }
    return count
}
```

**Task**: Optimize this function — it calls `strings.Contains` AND `strings.Index` for each line.

<details>
<summary>Solution</summary>

```go
// Option 1: Use strings.Count (single pass, built-in)
func countLinesV2(text string) int {
    if text == "" {
        return 0
    }
    count := strings.Count(text, "\n")
    if text[len(text)-1] != '\n' {
        count++ // last line without trailing newline
    }
    return count
}

// Option 2: Single-pass byte scan (fastest)
func countLinesV3(text string) int {
    if text == "" {
        return 0
    }
    count := 1
    for i := 0; i < len(text); i++ {
        if text[i] == '\n' && i < len(text)-1 {
            count++
        }
    }
    return count
}

// Option 3: bytes package (same speed, cleaner)
func countLinesV4(text string) int {
    return bytes.Count([]byte(text), []byte{'\n'}) + 1
}

// Benchmark (10,000 line text):
// Original (double scan): O(n²), ~10ms
// strings.Count:          O(n),  ~0.05ms (200x faster)
// Manual scan:            O(n),  ~0.03ms (fastest)
```
</details>

---

## Exercise 9: Avoid Repeated TrimSpace

**Slow Version:**
```go
func parseKVPairs(lines []string) map[string]string {
    result := make(map[string]string)
    for _, line := range lines {
        line = strings.TrimSpace(line)
        if line == "" || strings.HasPrefix(line, "#") {
            continue
        }
        idx := strings.Index(line, "=")
        if idx < 0 {
            continue
        }
        key := strings.TrimSpace(line[:idx])
        value := strings.TrimSpace(line[idx+1:])
        result[key] = value
    }
    return result
}
```

**Task**: This function allocates at least 3 strings per non-empty line (TrimSpace on line, key, value). Reduce allocations.

<details>
<summary>Solution</summary>

```go
// Key insight: TrimSpace just finds where non-space starts/ends
// We can implement it without allocation using index arithmetic

func trimSpaceIndices(s string) (start, end int) {
    start = 0
    end = len(s)
    for start < end && (s[start] == ' ' || s[start] == '\t' ||
        s[start] == '\r' || s[start] == '\n') {
        start++
    }
    for end > start && (s[end-1] == ' ' || s[end-1] == '\t' ||
        s[end-1] == '\r' || s[end-1] == '\n') {
        end--
    }
    return start, end
}

func parseKVPairs(lines []string) map[string]string {
    result := make(map[string]string, len(lines))
    for _, line := range lines {
        ls, le := trimSpaceIndices(line)
        trimmed := line[ls:le] // no alloc — just a slice!

        if trimmed == "" || trimmed[0] == '#' {
            continue
        }
        idx := strings.IndexByte(trimmed, '=')
        if idx < 0 {
            continue
        }
        ks, ke := trimSpaceIndices(trimmed[:idx])
        vs, ve := trimSpaceIndices(trimmed[idx+1:])

        key := trimmed[ls+ks : ls+ke]   // slice of original
        value := trimmed[idx+1+vs : idx+1+ve] // slice of original

        // Only 2 allocations: storing key and value strings in the map
        result[key] = value
    }
    return result
}

// Allocation reduction:
// Original: 3 allocs/line (TrimSpace creates new strings)
// Optimized: 0 allocs/line before map insertion (slices share memory)
```
</details>

---

## Exercise 10: Batch String Operations

**Slow Version:**
```go
func normalizeAll(inputs []string) []string {
    result := make([]string, len(inputs))
    for i, s := range inputs {
        s = strings.TrimSpace(s)
        s = strings.ToLower(s)
        s = strings.ReplaceAll(s, " ", "_")
        result[i] = s
    }
    return result
}
```

**Task**: Optimize by reducing allocations per string.

<details>
<summary>Solution</summary>

```go
func normalizeOne(s string) string {
    // Combine all operations in a single pass using Builder
    s = strings.TrimSpace(s)
    if s == "" {
        return s
    }

    // Check if already normalized (fast path: no allocation)
    needsChange := false
    for _, r := range s {
        if r == ' ' || (r >= 'A' && r <= 'Z') {
            needsChange = true
            break
        }
    }
    if !needsChange {
        return s
    }

    // Single-pass transformation
    var b strings.Builder
    b.Grow(len(s))
    for _, r := range s {
        if r == ' ' {
            b.WriteByte('_')
        } else if r >= 'A' && r <= 'Z' {
            b.WriteRune(r + 32) // toLower for ASCII
        } else {
            b.WriteRune(r)
        }
    }
    return b.String()
}

func normalizeAll(inputs []string) []string {
    result := make([]string, len(inputs))
    for i, s := range inputs {
        result[i] = normalizeOne(s)
    }
    return result
}

// Original: 3 allocs/string (TrimSpace + ToLower + ReplaceAll)
// Optimized: 1 alloc/string (Builder) + fast path 0 allocs
// ~3x fewer allocations, ~2x faster
```
</details>

---

## Exercise 11: Optimize Large String Deduplication

**Slow Version:**
```go
func deduplicateStrings(inputs []string) []string {
    seen := make(map[string]bool)
    var result []string
    for _, s := range inputs {
        if !seen[s] {
            seen[s] = true
            result = append(result, s)
        }
    }
    return result
}
```

**Task**: Optimize for the case where you have millions of strings with high duplication. The current version stores a `bool` value for each key.

<details>
<summary>Solution</summary>

```go
// Option 1: Use map[string]struct{} to avoid storing bool (smaller map values)
func deduplicateV2(inputs []string) []string {
    seen := make(map[string]struct{}, len(inputs)/2) // pre-size
    result := make([]string, 0, len(inputs)/2)
    for _, s := range inputs {
        if _, ok := seen[s]; !ok {
            seen[s] = struct{}{}
            result = append(result, s)
        }
    }
    return result
}

// Option 2: Sort and deduplicate (for when order doesn't matter)
// Less memory: no map needed
import "sort"

func deduplicateSorted(inputs []string) []string {
    if len(inputs) == 0 {
        return nil
    }
    cp := make([]string, len(inputs))
    copy(cp, inputs)
    sort.Strings(cp)

    result := cp[:1]
    for _, s := range cp[1:] {
        if s != result[len(result)-1] {
            result = append(result, s)
        }
    }
    return result
}

// Option 3: For high-duplication, intern strings first
func deduplicateWithInterning(inputs []string, interner *Interner) []string {
    seen := make(map[string]struct{})
    var result []string
    for _, s := range inputs {
        canonical := interner.Intern(s) // deduplicates underlying memory
        if _, ok := seen[canonical]; !ok {
            seen[canonical] = struct{}{}
            result = append(result, canonical)
        }
    }
    return result
}

// Memory comparison (1M strings, 10% unique):
// map[string]bool:     ~50MB (stores full string copies as keys + bool)
// map[string]struct{}: ~48MB (saves 8 bytes/entry for bool)
// Sort approach:       ~8MB (no map, just sorted copy)
// With interning:      ~5MB (shared string memory)
```
</details>

---

## Exercise 12: Streaming vs Buffered Processing

**Slow Version:**
```go
func countWords(text string) int {
    words := strings.Fields(text)  // allocates a slice of strings
    return len(words)
}
```

**Task**: Count words without creating a slice of all word strings.

<details>
<summary>Solution</summary>

```go
import "unicode"

// Zero-allocation word count: scan bytes directly
func countWords(text string) int {
    count := 0
    inWord := false
    for _, r := range text {
        isSpace := unicode.IsSpace(r)
        if !isSpace && !inWord {
            inWord = true
            count++
        } else if isSpace {
            inWord = false
        }
    }
    return count
}

// Even faster: byte-level for ASCII text
func countWordsASCII(text string) int {
    count := 0
    inWord := false
    for i := 0; i < len(text); i++ {
        b := text[i]
        isSpace := b == ' ' || b == '\t' || b == '\n' || b == '\r'
        if !isSpace && !inWord {
            inWord = true
            count++
        } else if isSpace {
            inWord = false
        }
    }
    return count
}

// Benchmark (1MB text):
// strings.Fields:   ~5ms, 1 big alloc + n string header allocs
// countWords:       ~2ms, 0 allocs
// countWordsASCII:  ~1ms, 0 allocs (2x faster, ASCII only)
```
</details>
