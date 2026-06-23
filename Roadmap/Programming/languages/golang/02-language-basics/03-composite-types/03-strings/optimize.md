# Strings in Go — Optimize

## Exercise 1 — Replace + concatenation with Builder 🟢

**Problem:** The following function builds a comma-separated list but is very slow for large inputs.

```go
func joinComma(items []string) string {
    result := ""
    for i, item := range items {
        if i > 0 {
            result += ","
        }
        result += item
    }
    return result
}
```

**Benchmark baseline:** 10000 items → ~50ms, 5000 allocs/op

<details>
<summary>Optimized Solution</summary>

```go
func joinComma(items []string) string {
    // Option 1: strings.Join (simplest)
    return strings.Join(items, ",")

    // Option 2: strings.Builder with Grow
    // var sb strings.Builder
    // total := len(items) - 1 // separators
    // for _, s := range items { total += len(s) }
    // sb.Grow(total)
    // for i, item := range items {
    //     if i > 0 { sb.WriteByte(',') }
    //     sb.WriteString(item)
    // }
    // return sb.String()
}
```

**Result:** ~0.5ms, 1 alloc/op (the final string only)

**Why:** `strings.Join` pre-calculates the total length and allocates once. The Builder approach with `Grow` achieves the same. Both are O(n) vs the original O(n^2).
</details>

---

## Exercise 2 — Avoid repeated ToLower in loop 🟢

**Problem:** Case-insensitive deduplication calls ToLower inside a hot loop.

```go
func deduplicateCaseInsensitive(items []string) []string {
    seen := make(map[string]bool)
    var result []string
    for _, item := range items {
        key := strings.ToLower(item) // allocates every iteration
        if !seen[key] {
            seen[key] = true
            result = append(result, item)
        }
    }
    return result
}
```

**Problem:** `strings.ToLower` allocates a new string every call even when the item is already lowercase.

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Accept the cost but avoid double work
// The current code is actually reasonable. ToLower is O(n) per string.
// Main optimization: avoid calling ToLower twice if you store lowercased keys

// Option 2: Use strings.EqualFold in a different approach (only if N is tiny)

// Option 3: For ASCII-only data, write a fast no-alloc toLower check
func isAlreadyLower(s string) bool {
    for i := 0; i < len(s); i++ {
        c := s[i]
        if c >= 'A' && c <= 'Z' {
            return false
        }
    }
    return true
}

func deduplicateCaseInsensitive(items []string) []string {
    seen := make(map[string]bool, len(items))
    result := make([]string, 0, len(items))
    for _, item := range items {
        var key string
        if isAlreadyLower(item) {
            key = item // no allocation needed
        } else {
            key = strings.ToLower(item)
        }
        if !seen[key] {
            seen[key] = true
            result = append(result, item)
        }
    }
    return result
}
```

**Result:** ~30-50% fewer allocations for mixed-case input where many items are already lowercase.
</details>

---

## Exercise 3 — Replace chained strings.Replace with NewReplacer 🟡

**Problem:** HTML escaping using chained calls scans the string 5 times.

```go
func escapeHTML(s string) string {
    s = strings.Replace(s, "&", "&amp;", -1)
    s = strings.Replace(s, "<", "&lt;", -1)
    s = strings.Replace(s, ">", "&gt;", -1)
    s = strings.Replace(s, "\"", "&#34;", -1)
    s = strings.Replace(s, "'", "&#39;", -1)
    return s
}
```

**Problem:** 5 passes through the string, 5 intermediate allocations.

<details>
<summary>Optimized Solution</summary>

```go
var htmlReplacer = strings.NewReplacer(
    "&", "&amp;",
    "<", "&lt;",
    ">", "&gt;",
    "\"", "&#34;",
    "'", "&#39;",
)

func escapeHTML(s string) string {
    return htmlReplacer.Replace(s)
}
```

**Key points:**
1. `htmlReplacer` is declared as a package-level variable — it is built once at init time.
2. `NewReplacer` scans the string in a single pass using a trie internally.
3. Result: 1 allocation (the output string), 1 pass, ~5x faster for typical HTML.

**Benchmark improvement:**
- Before: 5 allocs/op
- After: 1 alloc/op (or 0 if output is written to a Builder via `r.WriteString`)
</details>

---

## Exercise 4 — Avoid []byte ↔ string roundtrip 🟡

**Problem:** A log formatter unnecessarily converts between string and []byte.

```go
func formatLogLine(level, message string) string {
    b := []byte("[")
    b = append(b, []byte(level)...)
    b = append(b, []byte("] ")...)
    b = append(b, []byte(message)...)
    return string(b)
}
```

**Problem:** Every `[]byte(string)` conversion allocates.

<details>
<summary>Optimized Solution</summary>

```go
func formatLogLine(level, message string) string {
    var sb strings.Builder
    sb.Grow(1 + len(level) + 2 + len(message))
    sb.WriteByte('[')
    sb.WriteString(level)
    sb.WriteString("] ")
    sb.WriteString(message)
    return sb.String()
}
```

**Or even simpler for fixed format:**
```go
func formatLogLine(level, message string) string {
    return "[" + level + "] " + message
}
// For 3 parts, the compiler may optimize to a single allocation
```

**Result:** 1 alloc/op (the final string) vs 4+ with the original approach.
</details>

---

## Exercise 5 — Eliminate allocation in hot read path 🔴

**Problem:** A high-throughput HTTP router converts request path bytes to string for lookup.

```go
type Router struct {
    routes map[string]http.HandlerFunc
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
    path := string(req.URL.Path) // allocation per request!
    handler, ok := r.routes[path]
    if ok {
        handler(w, req)
    }
}
```

**Note:** `req.URL.Path` is already a string in the standard library. This example simulates a scenario where you have `[]byte` from a custom parser.

**Problem (simulated with []byte):** Converting `[]byte` to `string` for every map lookup allocates.

<details>
<summary>Optimized Solution</summary>

```go
// The compiler already optimizes map[string(b)] lookups in Go 1.6+
// for the pattern: m[string(byteSlice)]

type Router struct {
    routes map[string]http.HandlerFunc
}

func (r *Router) lookup(pathBytes []byte) http.HandlerFunc {
    // This does NOT allocate — compiler optimization for map key lookup
    return r.routes[string(pathBytes)]
}

// For custom hot-path parsers where you control the []byte:
// Use unsafe zero-copy only if profiling confirms it is necessary
import "unsafe"

func lookupUnsafe(routes map[string]http.HandlerFunc, path []byte) http.HandlerFunc {
    // Zero-copy: safe only because map lookup does not retain the string
    return routes[unsafe.String(unsafe.SliceData(path), len(path))]
}
```

**Result:** The compiler optimization eliminates the allocation in most cases. Measure first before reaching for `unsafe`.
</details>

---

## Exercise 6 — Fix substring memory leak 🔴

**Problem:** A session store extracts session tokens from large HTTP cookie headers.

```go
type SessionStore struct {
    sessions map[string]*Session
}

func (s *SessionStore) ParseCookie(cookieHeader string) string {
    // cookieHeader might be 4KB of cookie data
    i := strings.Index(cookieHeader, "session=")
    if i < 0 {
        return ""
    }
    i += len("session=")
    j := strings.Index(cookieHeader[i:], ";")
    if j < 0 {
        return cookieHeader[i:]
    }
    return cookieHeader[i : i+j] // PROBLEM: keeps 4KB alive!
}
```

**Problem:** Each extracted token retains the full 4KB cookie header in memory.

<details>
<summary>Optimized Solution</summary>

```go
func (s *SessionStore) ParseCookie(cookieHeader string) string {
    i := strings.Index(cookieHeader, "session=")
    if i < 0 {
        return ""
    }
    i += len("session=")
    j := strings.Index(cookieHeader[i:], ";")

    var token string
    if j < 0 {
        token = cookieHeader[i:]
    } else {
        token = cookieHeader[i : i+j]
    }

    // strings.Clone creates an independent copy, releasing the 4KB backing array
    return strings.Clone(token)
}
```

**Memory impact:**
- Before: Each active session holds a reference to a 4KB cookie header
- After: Each active session holds only ~32 bytes for its token

**When sessions number in the millions, this can save gigabytes.**
</details>

---

## Exercise 7 — Reuse Builder across calls 🟡

**Problem:** A high-frequency log formatter creates a new Builder for every log entry.

```go
type Logger struct{}

func (l *Logger) Format(fields map[string]string) string {
    var sb strings.Builder // new builder each call
    for k, v := range fields {
        fmt.Fprintf(&sb, "%s=%s ", k, v)
    }
    return strings.TrimSpace(sb.String())
}
```

**Problem:** `strings.Builder` allocates its internal buffer on every call.

<details>
<summary>Optimized Solution</summary>

```go
type Logger struct {
    mu sync.Mutex
    sb strings.Builder
}

func (l *Logger) Format(fields map[string]string) string {
    l.mu.Lock()
    defer l.mu.Unlock()

    l.sb.Reset() // reset length, keep capacity
    first := true
    for k, v := range fields {
        if !first {
            l.sb.WriteByte(' ')
        }
        l.sb.WriteString(k)
        l.sb.WriteByte('=')
        l.sb.WriteString(v)
        first = false
    }
    return l.sb.String()
}
```

**Alternative:** Use `sync.Pool` for concurrent, allocation-free reuse:
```go
var builderPool = sync.Pool{
    New: func() interface{} { return new(strings.Builder) },
}

func Format(fields map[string]string) string {
    sb := builderPool.Get().(*strings.Builder)
    sb.Reset()
    defer builderPool.Put(sb)

    for k, v := range fields {
        sb.WriteString(k)
        sb.WriteByte('=')
        sb.WriteString(v)
        sb.WriteByte(' ')
    }
    return strings.TrimSpace(sb.String())
}
```

**Result:** After warm-up, 0 allocations per format call (builder buffer is reused from pool).
</details>

---

## Exercise 8 — Use strings.IndexByte instead of strings.Index 🟡

**Problem:** A CSV parser searches for single-character delimiters using `strings.Index`.

```go
func splitCSV(line string) []string {
    var fields []string
    for {
        i := strings.Index(line, ",") // searches for string ","
        if i < 0 {
            fields = append(fields, line)
            break
        }
        fields = append(fields, line[:i])
        line = line[i+1:]
    }
    return fields
}
```

<details>
<summary>Optimized Solution</summary>

```go
func splitCSV(line string) []string {
    var fields []string
    for {
        i := strings.IndexByte(line, ',') // single byte search — faster
        if i < 0 {
            fields = append(fields, line)
            break
        }
        fields = append(fields, line[:i])
        line = line[i+1:]
    }
    return fields
}
```

**Why faster:** `strings.IndexByte` can use SIMD instructions (via `internal/bytealg`) to scan 16 or 32 bytes at a time. `strings.Index(s, ",")` has more setup overhead for the single-character case.

**Benchmark:** For long lines (1000+ bytes), `IndexByte` is typically 2-4x faster than `Index` for single-character separators.

**Best practice for CSV:** Use `encoding/csv` for production CSV parsing.
</details>

---

## Exercise 9 — Pre-allocate output slice 🟢

**Problem:** A log processor splits each line and collects results without pre-allocating.

```go
func processLines(data string) []string {
    lines := strings.Split(data, "\n")
    var results []string // starts nil, grows dynamically
    for _, line := range lines {
        trimmed := strings.TrimSpace(line)
        if trimmed != "" {
            results = append(results, trimmed)
        }
    }
    return results
}
```

<details>
<summary>Optimized Solution</summary>

```go
func processLines(data string) []string {
    lines := strings.Split(data, "\n")
    results := make([]string, 0, len(lines)) // pre-allocate with upper bound
    for _, line := range lines {
        trimmed := strings.TrimSpace(line)
        if trimmed != "" {
            results = append(results, trimmed)
        }
    }
    return results
}
```

**Why better:** Pre-allocating with `len(lines)` as capacity avoids repeated `append` reallocations. Even though some lines may be blank (and skipped), the capacity is an upper bound. Trades a small over-allocation for zero reallocations.

**Alternative:** Count non-blank lines first, then allocate exactly:
```go
count := 0
for _, line := range lines {
    if strings.TrimSpace(line) != "" { count++ }
}
results := make([]string, 0, count)
```
(2-pass but exact allocation — worth it only if the output is very large and long-lived)
</details>

---

## Exercise 10 — Replace fmt.Sprintf with direct Builder writes 🟡

**Problem:** A hot path uses `fmt.Sprintf` for simple string formatting inside a tight loop.

```go
func buildQueryParams(params map[string]string) string {
    var parts []string
    for k, v := range params {
        parts = append(parts, fmt.Sprintf("%s=%s", k, v)) // Sprintf allocates
    }
    return strings.Join(parts, "&")
}
```

<details>
<summary>Optimized Solution</summary>

```go
func buildQueryParams(params map[string]string) string {
    var sb strings.Builder
    first := true
    for k, v := range params {
        if !first {
            sb.WriteByte('&')
        }
        sb.WriteString(k)
        sb.WriteByte('=')
        sb.WriteString(v)
        first = false
    }
    return sb.String()
}
```

**Why better:**
1. Eliminates the intermediate `[]string` slice (1 alloc per param)
2. Eliminates `fmt.Sprintf` overhead (format parsing, reflection) for each param
3. Single final allocation for the result string

**Benchmark improvement:** For 10 params, typically 10x fewer allocations.

**When to keep Sprintf:** When you need number formatting, padding, or complex format verbs. For pure string concatenation, direct Builder writes are always faster.
</details>

---

## Exercise 11 — Lazy string construction 🔴

**Problem:** Detailed debug log messages are always built, even when debug logging is disabled.

```go
func processItem(item Item) {
    log.Printf("Processing item: id=%d, name=%s, tags=%v, meta=%+v",
        item.ID, item.Name, item.Tags, item.Meta)
    // ... actual processing
}
```

<details>
<summary>Optimized Solution</summary>

```go
// Option 1: Guard with log level check
const debugEnabled = false // or from config

func processItem(item Item) {
    if debugEnabled {
        log.Printf("Processing item: id=%d, name=%s, tags=%v, meta=%+v",
            item.ID, item.Name, item.Tags, item.Meta)
    }
    // ... actual processing
}

// Option 2: Lazy stringer interface
type ItemDebug struct{ item Item }

func (d ItemDebug) String() string {
    return fmt.Sprintf("id=%d, name=%s, tags=%v", d.item.ID, d.item.Name, d.item.Tags)
}

func processItem(item Item) {
    // String() is only called if the log level is active
    logger.Debug("Processing item", "item", ItemDebug{item})
}

// Option 3: Use slog (Go 1.21+) with lazy evaluation
import "log/slog"

func processItem(item Item) {
    slog.Debug("Processing item",
        slog.Int("id", item.ID),
        slog.String("name", item.Name),
    )
    // slog skips string formatting entirely if Debug level is disabled
}
```

**Impact:** In production with debug logging disabled, eliminates all string formatting overhead for debug messages — which can represent 30-50% of CPU time in verbose code paths.
</details>
