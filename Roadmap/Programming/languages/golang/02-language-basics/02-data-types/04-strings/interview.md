# Strings in Go — Interview Questions

## Junior Level Questions

---

**Q1: What is a string in Go?**

A: A string in Go is an immutable sequence of bytes. It is represented internally as a struct with two fields: a pointer to the byte data and a length. Strings are UTF-8 encoded by convention but can technically hold any bytes.

---

**Q2: What does `len("café")` return in Go?**

A: It returns `5`, not `4`. The character `é` (U+00E9) is encoded as 2 bytes in UTF-8 (0xC3 0xA9), so the string `"café"` contains 5 bytes even though it has 4 visible characters. To get the character count, use `utf8.RuneCountInString("café")` which returns `4`.

---

**Q3: What is the zero value of a string in Go?**

A: The zero value is `""` (the empty string). Unlike pointers, strings cannot be `nil`. A `var s string` declaration initializes `s` to `""`.

---

**Q4: What is the type of `s[0]` where `s` is a `string`?**

A: The type is `byte`, which is an alias for `uint8`. It represents the byte value at that position, not a character. For example, `"Hello"[0]` returns `72`, which is the ASCII code for `'H'`.

---

**Q5: Can you modify a string after it's created? Why or why not?**

A: No. Strings in Go are immutable. Once a string is created, its bytes cannot be changed. Attempting `s[0] = 'H'` causes a compile error: "cannot assign to s[0] (strings are immutable)". To modify string content, you must convert to `[]byte`, modify, then convert back.

---

**Q6: What is the difference between iterating a string with `for i := range s` and `for i, r := range s`?**

A: Both iterate over Unicode runes (characters), not bytes. The difference is:
- `for i := range s` — gives only the byte index of each rune's start
- `for i, r := range s` — gives both the byte index and the rune value
The byte index jumps by the number of bytes each rune occupies (1–4).

---

**Q7: How do you efficiently concatenate many strings in Go?**

A: Use `strings.Builder`. The `+` operator creates a new allocation for every concatenation, leading to O(n²) total work in a loop. `strings.Builder` uses an internal byte slice that grows as needed, resulting in amortized O(n) work.

```go
var b strings.Builder
for _, s := range items {
    b.WriteString(s)
}
result := b.String()
```

---

**Q8: What is the difference between a raw string literal and an interpreted string literal?**

A: Interpreted string literals use double quotes (`"..."`) and process escape sequences like `\n`, `\t`, `\\`. Raw string literals use backticks (`` ` ``...`` ` ``) and preserve the literal characters — no escape processing. Raw strings can span multiple lines and are useful for regex patterns, JSON, and SQL.

---

**Q9: What does `string(65)` produce?**

A: It produces `"A"`. When you convert an integer to a string, Go treats it as a Unicode code point. Code point 65 is 'A'. This is a common source of confusion. To get the string `"65"`, use `strconv.Itoa(65)` or `fmt.Sprint(65)`.

---

**Q10: How do you convert a string to a byte slice in Go?**

A: Use a type conversion: `b := []byte(s)`. This creates a copy of the string's bytes in a new mutable byte slice. You can then modify `b`. To convert back: `s2 := string(b)`.

---

## Middle Level Questions

---

**Q11: Explain the internal memory representation of a Go string.**

A: A Go string is a 16-byte struct on 64-bit systems:
```go
type StringHeader struct {
    Data uintptr // 8 bytes: pointer to byte array
    Len  int     // 8 bytes: number of bytes
}
```
The Data pointer points to a sequence of bytes, which may be in the read-only data segment (for literals) or on the heap (for runtime-created strings). Copying a string copies only the 16-byte header — the underlying byte data is shared. This is why string slicing is O(1) and doesn't allocate.

---

**Q12: Why can strings be used as map keys in Go but `[]byte` cannot?**

A: Map keys must be comparable (support `==` and `!=`). Strings are comparable because they are immutable — two strings are equal if they have the same length and same bytes. Slices (`[]byte`) are not comparable because they're references to mutable data — slice equality would be ambiguous (should it compare pointers, or values?).

---

**Q13: What is the difference between `strings.Replace` and `strings.ReplaceAll`?**

A: `strings.Replace(s, old, new, n)` replaces at most `n` non-overlapping instances of `old` with `new`. `strings.ReplaceAll(s, old, new)` is equivalent to `strings.Replace(s, old, new, -1)` — replaces all instances. Passing `n = -1` to `Replace` is the same as `ReplaceAll`.

---

**Q14: What does `strings.Fields("  hello   world  ")` return?**

A: It returns `["hello", "world"]`. `strings.Fields` splits on any whitespace (spaces, tabs, newlines) and removes leading/trailing whitespace. Unlike `strings.Split(s, " ")`, it handles multiple consecutive spaces and trims edges.

---

**Q15: How does Go handle invalid UTF-8 in strings?**

A: Go doesn't reject invalid UTF-8 in strings — a string can hold any bytes. When you use a `range` loop over a string with invalid UTF-8, Go replaces each invalid byte with the Unicode replacement character U+FFFD (rune value 65533). The `unicode/utf8` package provides `utf8.ValidString(s)` to check validity.

---

**Q16: Why is `strings.EqualFold(a, b)` preferred over `strings.ToLower(a) == strings.ToLower(b)`?**

A: `strings.ToLower` allocates a new string for each call. For case-insensitive comparison, this means 2 allocations per comparison. `strings.EqualFold` compares without allocating any new strings — it decodes runes and compares them case-insensitively in-place. This can be 2-5x faster in tight loops.

---

**Q17: What is the purpose of `strings.NewReader`?**

A: `strings.NewReader(s)` creates an `io.Reader` that reads from a string. It's used when an API requires an `io.Reader` but you have a string:
```go
resp, _ := http.Post(url, "application/json",
    strings.NewReader(`{"key":"value"}`))
```
It also implements `io.Seeker` and `io.WriterTo`.

---

**Q18: Explain why `s[1:3]` doesn't copy memory in Go.**

A: String slicing creates a new string header (pointer + length) pointing into the same underlying byte array. The new header's pointer is the original pointer plus the start offset, and the length is `end - start`. No bytes are copied. This is why slicing is O(1). The downside: if you only need a small slice of a large string, the large string's memory won't be GC'd because the slice keeps it alive.

---

**Q19: How would you count the number of Unicode characters (not bytes) in a string?**

A: Use `utf8.RuneCountInString(s)` from the `unicode/utf8` package. Alternatively, `len([]rune(s))` works but allocates a new rune slice. For performance, prefer `utf8.RuneCountInString`.

---

**Q20: What is `strings.Builder.Grow(n)` used for?**

A: `Grow(n)` ensures that the builder has capacity for at least `n` more bytes without reallocation. If the current capacity minus length is already >= n, it's a no-op. Use it when you know the approximate final size to avoid multiple reallocations as the builder grows. For example: `b.Grow(len(template) * 2)` before filling in a template.

---

## Senior Level Questions

---

**Q21: A service is experiencing high GC pause times. Profiling shows many small string allocations in a hot path. What strategies would you use to reduce allocations?**

A: Several strategies:
1. **strings.EqualFold** instead of `strings.ToLower(a) == strings.ToLower(b)` for case-insensitive comparison
2. **Intern strings** that repeat often (metric names, header names, log levels)
3. **Pre-allocate `strings.Builder`** with `Grow(estimatedSize)` to reduce reallocations
4. **Use `strings.Contains` etc.** which don't allocate (read-only operations)
5. **Avoid `fmt.Sprintf`** in hot paths — use direct writes to a Builder
6. **Zero-copy conversions** with `unsafe.String`/`unsafe.StringData` where safe
7. **Sync.Pool** for Builder instances to reuse allocated buffers

---

**Q22: How would you implement a thread-safe string cache that interleaves many concurrent reads with occasional writes?**

A: Use `sync.Map` for the cache with a "store once" semantic:
```go
type StringCache struct {
    m sync.Map
}
func (c *StringCache) Get(key string) (string, bool) {
    v, ok := c.m.Load(key)
    if !ok { return "", false }
    return v.(string), true
}
func (c *StringCache) Set(key, value string) {
    c.m.Store(key, value)
}
```
For higher-write scenarios, use `sync.RWMutex` with a regular map. For even higher performance, consider sharding the cache into multiple maps with separate locks.

---

**Q23: Explain why long-lived substrings can cause memory leaks and how to fix them.**

A: A substring shares the underlying byte array with its parent. If you take a 10-byte substring of a 10MB string, the 10MB array stays in memory as long as the substring is alive. This is a GC retention issue, not a traditional memory leak.

Fix: Copy the substring to break the reference:
```go
// Breaks the reference to parent's large buffer
sub = strings.Clone(sub) // Go 1.20+
// or:
sub = string([]byte(sub)) // older Go versions
```

---

**Q24: When would you use `unsafe.String` and `unsafe.StringData` and what are the safety requirements?**

A: These are used for zero-copy conversion between `string` and `[]byte`:
- `unsafe.String(ptr *byte, len int) string` — create string without copy
- `unsafe.StringData(s string) *byte` — get data pointer

Safety requirements:
1. The `[]byte` must NOT be modified while the string is live
2. The string must NOT outlive the `[]byte`
3. The `[]byte` must have at least `len` readable bytes

Common use case: temporary string key for map lookup where the `[]byte` is immediately discarded and the map key won't be stored.

---

**Q25: How does Go's string comparison using `<` work for non-ASCII strings?**

A: Go compares strings byte-by-byte lexicographically. It does NOT compare by Unicode code point order or by locale-aware collation. This means `"é" < "f"` returns `true` not because 'é' (U+00E9) < 'f' (U+0066), but because the first byte of "é" in UTF-8 (0xC3) < 'f' in ASCII (0x66) is false... actually 0xC3 = 195 > 0x66 = 102, so `"é" > "f"` in Go.

For locale-aware string sorting, use the `golang.org/x/text/collate` package.

---

## Scenario-Based Questions

---

**Q26: You have a function that receives a large JSON response (1-50MB) and extracts a small field from it. What would you watch out for?**

A:
1. **Memory retention**: if you take a substring of the JSON, it keeps the entire JSON body in memory. Use `strings.Clone()` or `json.Unmarshal` to extract the field properly.
2. **Allocation**: large strings mean large `[]byte(s)` conversions. Consider using a streaming JSON parser.
3. **UTF-8 validity**: validate the JSON is valid UTF-8 if it comes from an untrusted source.
4. **Length bounds**: check the field length before creating substrings to avoid panics.

---

**Q27: Your API endpoint is vulnerable to ReDoS (Regular Expression Denial of Service). How would strings/regexp best practices help?**

A:
1. Compile regex **once** at startup with `regexp.MustCompile` — avoid recompilation per request
2. Set a **timeout** on regex matching using `regexp.MatchString` with a context
3. Validate and **limit input length** before applying regex
4. Prefer simple string operations (`strings.Contains`, `strings.HasPrefix`) over regex for simple patterns
5. Use RE2-safe patterns — Go's regexp package uses RE2 which guarantees O(n) matching, eliminating catastrophic backtracking

---

**Q28: A function that builds a CSV file is too slow. Walk through how you would diagnose and fix it.**

A:
1. **Profile**: run `go test -bench=. -cpuprofile=cpu.prof`, then `go tool pprof cpu.prof`
2. **Identify**: likely seeing `runtime.mallocgc` and `runtime.memmove` in hot path from string concatenation
3. **Fix**:
   - Replace `+` concatenation with `strings.Builder`
   - Pre-allocate with `b.Grow(estimatedSize)`
   - Use `b.WriteByte(',')` instead of `b.WriteString(",")` for single-byte separators
   - Consider writing directly to `io.Writer` (like a file or HTTP response) instead of building the whole string in memory

---

**Q29: How would you implement case-insensitive, accent-insensitive string search in Go?**

A: Use the `golang.org/x/text` package:
```go
import (
    "golang.org/x/text/transform"
    "golang.org/x/text/unicode/norm"
    "golang.org/x/text/unicode/fold"
)

// Normalize to NFC, then case-fold, then search
func normalizeSearch(s string) string {
    t := transform.Chain(norm.NFD, fold.Unicode, norm.NFC)
    result, _, _ := transform.String(t, s)
    return result
}
// Then: strings.Contains(normalizeSearch(text), normalizeSearch(query))
```
Built-in Go only does simple Unicode case folding via `strings.EqualFold`. Accent-insensitive requires the x/text package.

---

**Q30: Describe how you would design a system to process 100 million log lines (strings) efficiently in Go.**

A:
1. **Streaming**: don't load all into memory; use `bufio.Scanner` to process line by line
2. **Parallel processing**: worker pool with bounded goroutines; each worker processes batches
3. **String interning**: intern repeated values (log level, service name, host) to reduce memory
4. **Avoid allocation in hot path**: pre-allocate parsers, reuse `strings.Builder` instances via `sync.Pool`
5. **Memory layout**: consider packed string storage (offset tables) for batch retention
6. **Benchmarking**: use `testing.B` to measure per-line processing cost
7. **GC tuning**: set `GOGC=200` or higher to reduce GC frequency when processing large batches

---

## FAQ

---

**FAQ1: When should I use `strings.Split` vs `strings.Fields`?**

`strings.Split(s, sep)` splits on an exact separator and includes empty strings from consecutive separators. `strings.Fields(s)` splits on any whitespace, trims leading/trailing whitespace, and never returns empty strings. Use `Fields` for parsing whitespace-separated tokens (like command-line arguments), and `Split` for structured formats with specific delimiters (like CSV with commas).

---

**FAQ2: Is it safe to use a `string` as a map key from multiple goroutines?**

Yes. Map reads are safe from multiple goroutines (as long as no writes are happening concurrently). String values themselves are safe since they're immutable. However, the **map** must be protected with a mutex if any goroutine writes to it.

---

**FAQ3: What's the difference between `strings.TrimSpace` and `strings.Trim`?**

`strings.TrimSpace(s)` trims all leading and trailing Unicode whitespace. `strings.Trim(s, cutset)` trims all leading and trailing characters that appear in `cutset`. For example, `strings.Trim("***hello***", "*")` returns `"hello"`.

---

**FAQ4: Does string comparison (`==`) work for multi-byte characters?**

Yes. `"世界" == "世界"` is `true`. Go compares strings byte-by-byte, so as long as the UTF-8 encoding is identical, the comparison works correctly.

---

**FAQ5: Why does `fmt.Println(string([]byte{0xff}))` print a replacement character?**

Go converts the byte to a string (valid operation — any bytes allowed), but `fmt.Println` outputs to the terminal which expects valid UTF-8. The terminal (or fmt) replaces invalid UTF-8 bytes with `?` or `\xef\xbf\xbd` (the replacement character U+FFFD). The string itself contains 0xFF.
