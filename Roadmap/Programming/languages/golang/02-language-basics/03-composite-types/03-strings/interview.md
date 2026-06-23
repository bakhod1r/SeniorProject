# Strings in Go — Interview Questions

## Junior Level

**Q1: What is a string in Go?**
A: A string is an immutable sequence of bytes. Internally it is a two-word struct containing a pointer to the byte data and a length. It is NOT a null-terminated C string and it is NOT a sequence of characters — it is a sequence of bytes.

---

**Q2: What does `len("Hello, 世界")` return and why?**
A: It returns 13, not 9. `len()` on a string counts bytes, not Unicode characters. Each Chinese character ("世" and "界") takes 3 bytes in UTF-8 encoding, so the string is 7 ASCII bytes + 3 + 3 = 13 bytes.

---

**Q3: Can you modify a string in Go?**
A: No. Strings are immutable. `s[0] = 'H'` is a compile error. To modify a string, you must convert it to `[]byte`, modify the bytes, and convert back to `string`.

```go
b := []byte(s)
b[0] = 'H'
s = string(b)
```

---

**Q4: What is the difference between `byte` and `rune`?**
A: `byte` is an alias for `uint8` (0–255) and represents a single byte — suitable for ASCII characters. `rune` is an alias for `int32` and represents a Unicode code point — suitable for any Unicode character.

---

**Q5: How do you count the number of characters (not bytes) in a string?**
A:
```go
import "unicode/utf8"
n := utf8.RuneCountInString(s)
// Or count via range:
count := 0
for range s { count++ }
```

---

**Q6: What does iterating over a string with `range` give you?**
A: The loop variable `i` is the byte offset of the current rune, and `r` is the rune value (`int32`). Range automatically decodes UTF-8, so for multi-byte characters the index jumps by more than 1.

---

**Q7: Why is string concatenation with `+` slow in a loop?**
A: Each `+` creates a new string allocation and copies all previous bytes into the new buffer. With N strings, this is O(N^2) total work. Use `strings.Builder` instead, which amortizes allocations like a slice.

---

**Q8: What is `strings.Builder` and when do you use it?**
A: `strings.Builder` is a type that efficiently builds a string by appending parts with `WriteString`, `WriteByte`, or `WriteRune`. It uses an internal `[]byte` that grows exponentially. Call `String()` when done. Use it whenever you build a string in a loop.

---

**Q9: What is the zero value of a string in Go?**
A: An empty string `""`. Strings cannot be nil. `var s string` gives `s == ""`.

---

**Q10: What is a raw string literal?**
A: A string enclosed in backticks (`` ` ``). Backslash escape sequences are not interpreted, and the string can span multiple lines. Useful for regular expressions and multi-line text.

---

## Middle Level

**Q11: What does `strings.Cut` do? When should you prefer it over `strings.Index`?**
A: `strings.Cut(s, sep)` returns the part before the separator, the part after, and a bool indicating whether the separator was found. It is cleaner than `strings.Index` when you want to split a string into two parts around a known separator (like `"key=value"` or `"user@host"`).

---

**Q12: What is the difference between `strings.Split` and `strings.Fields`?**
A: `strings.Split(s, sep)` splits on the exact separator and preserves empty strings (e.g., splitting `"a,,b"` by `","` gives `["a", "", "b"]`). `strings.Fields(s)` splits on any whitespace and drops empty fields, so `"  a  b  "` gives `["a", "b"]`.

---

**Q13: What is `strings.NewReplacer` and why is it more efficient than chained `strings.Replace`?**
A: `strings.NewReplacer` takes pairs of old/new strings and scans the input only once, replacing all patterns in a single pass. Chained `strings.Replace` calls scan the string multiple times. For HTML entity escaping or similar multi-pattern replacement, `NewReplacer` is significantly faster.

---

**Q14: Can you copy a `strings.Builder`? What happens?**
A: No. `strings.Builder` uses an internal self-pointer (`addr *Builder`) to detect copies. If you copy the Builder value and call any write method on the copy, it panics: `strings: illegal use of non-zero Builder copied by value`.

---

**Q15: What is `strings.Clone` and when was it added?**
A: Added in Go 1.20, `strings.Clone(s)` returns an independent copy of the string's backing bytes. It is used to prevent the "substring retaining large backing array" memory leak. Without Clone, a small substring keeps the original large string's memory alive.

---

**Q16: How do you perform a case-insensitive string comparison in Go?**
A: Use `strings.EqualFold(a, b)`. This is more efficient than converting both to lowercase and comparing, and handles some Unicode folding cases. For full Unicode support, use `golang.org/x/text/cases`.

---

**Q17: What does `strings.Map` do? Give an example.**
A: `strings.Map(fn, s)` applies the function `fn` to each rune in `s` and returns a new string. If `fn` returns -1, the rune is dropped. Example:

```go
removeDigits := strings.Map(func(r rune) rune {
    if r >= '0' && r <= '9' { return -1 }
    return r
}, "h3ll0 w0rld")
// Result: "hll wrld"
```

---

**Q18: How do you read a string as an `io.Reader` without copying the bytes?**
A: Use `strings.NewReader(s)`, which returns an `*strings.Reader` that implements `io.Reader`, `io.Seeker`, and `io.WriterTo`. It wraps the string without allocating a copy of the data.

---

## Senior Level

**Q19: Explain why `m[string(b)]` does not allocate in a map lookup.**
A: The Go compiler recognizes `string(b)` used as a map key in a lookup expression as a temporary that does not escape. It rewrites the lookup to pass the byte slice pointer directly to the map runtime function, avoiding a heap allocation for the temporary string.

---

**Q20: How can a substring cause a memory leak? How do you fix it?**
A: When you slice a string (`big[a:b]`), the resulting string header points into the original backing array. If the original large string is no longer referenced but a small substring is, the GC cannot collect the large backing array — it remains live as long as the substring is reachable. Fix: `strings.Clone(big[a:b])` creates an independent copy.

---

**Q21: Describe the internal structure of `strings.Builder` and why it panics on copy.**
A: `strings.Builder` contains an `addr *Builder` that is set to point to itself on first write. On every write, `copyCheck()` compares `addr` to `&b`. If they differ (because the Builder was copied), it panics. This is a deliberate safety mechanism to catch incorrect copy-by-value usage.

---

**Q22: When and how does the compiler optimize `string` <-> `[]byte` conversions to avoid allocation?**
A: Three known optimizations:
1. `m[string(b)]` — map lookup with inline string conversion
2. `switch string(b)` — switch on inline string conversion
3. Short strings (<=32 bytes) in some runtime paths use a stack `tmpBuf`

All others allocate. Use `unsafe.String`/`unsafe.Slice` for zero-copy in hot paths, with full understanding of the safety constraints.

---

**Q23: What is the memory layout of a string in terms of GC scanning?**
A: The StringHeader's `Data` pointer is a GC root — if the string is live, the GC keeps the backing array alive. The backing array itself is marked `noscan` (no pointer fields), so the GC does not trace into it. This makes string backing arrays cheap for the GC compared to pointer-containing types.

---

## Scenario Questions

**Q24: You have a function that parses a 100MB file and extracts 10,000 small token strings. After the function returns, memory stays high. Why?**
A: Each extracted token is a substring of the 100MB file's backing array. All 10,000 tokens each hold a reference to the original 100MB backing array, keeping it alive. Fix: convert each token with `strings.Clone(token)` to create independent copies before returning.

---

**Q25: A REST API handler builds a JSON response by concatenating strings in a loop and you notice high GC pause times. What would you do?**
A: Replace the concatenation loop with `strings.Builder`, pre-growing with `sb.Grow(estimatedSize)`. Alternatively, use `encoding/json` with struct marshaling to avoid manual string building entirely. Profile with `go test -benchmem` to confirm allocation reduction.

---

**Q26: You need to implement a header parser for HTTP/1.1 that processes 100K requests/sec. Each header line is a []byte from the network buffer. How do you extract the header name and value without allocating?**
A: Keep everything as `[]byte` throughout the parsing. Only convert to `string` at the output boundary using `unsafe.String(unsafe.SliceData(b), len(b))`. The unsafe conversion is safe here because the backing buffer is not modified while the string is in use, and header names/values are immediately consumed by the handler.

---

## FAQ

**Q: Is `""` the same as `var s string`?**
A: Yes. Both are the zero value for string. Go has no nil strings.

**Q: Does Go support string formatting like Python f-strings?**
A: Not with syntax sugar. Use `fmt.Sprintf("Hello, %s!", name)` or `strings.Builder` with `fmt.Fprintf(&sb, ...)`.

**Q: Can I use strings as map keys?**
A: Yes. Strings are valid map keys because they are comparable with `==`. The runtime uses AES-NI accelerated hashing for string map keys on supporting hardware.

**Q: What is the difference between `strings.Contains` and `strings.Index`?**
A: `strings.Contains(s, sub)` returns a bool. `strings.Index(s, sub)` returns the byte offset (-1 if not found). Use `Contains` when you only need to know if a substring exists; use `Index` when you need the position.

**Q: Are Go strings thread-safe?**
A: Yes — because strings are immutable, they can be shared between goroutines without synchronization. However, `strings.Builder` is NOT thread-safe and must not be used concurrently.

---

## Additional Middle-Level Questions

---

### Q26: What is `strings.Map` and how does returning `-1` from the function affect the output?

**Answer:**
`strings.Map(mapping func(rune) rune, s string) string` applies `mapping` to each rune in `s` and returns the result. If the function returns `-1` for a rune, that rune is **deleted** from the output string.

```go
// Remove all vowels
removeVowels := func(r rune) rune {
    if strings.ContainsRune("aeiouAEIOU", r) {
        return -1 // delete
    }
    return r
}
result := strings.Map(removeVowels, "Hello, World!")
fmt.Println(result) // "Hll, Wrld!"

// ROT13 cipher
rot13 := func(r rune) rune {
    switch {
    case r >= 'A' && r <= 'Z':
        return 'A' + (r-'A'+13)%26
    case r >= 'a' && r <= 'z':
        return 'a' + (r-'a'+13)%26
    }
    return r
}
fmt.Println(strings.Map(rot13, "Hello")) // "Uryyb"
```

---

### Q27: What is `strings.ContainsAny` and how does it differ from `strings.Contains`?

**Answer:**
- `strings.Contains(s, substr)` checks if `s` contains the substring `substr` (a sequence of characters).
- `strings.ContainsAny(s, chars)` checks if `s` contains **any one** of the individual characters in the `chars` string.

```go
strings.Contains("hello", "ell")     // true  — contains substring "ell"
strings.ContainsAny("hello", "aeiou") // true  — contains at least one vowel
strings.ContainsAny("hello", "xyz")  // false — none of x, y, z in "hello"
strings.ContainsAny("hello", "el")   // true  — 'e' or 'l' found

// ContainsAny is useful for checking punctuation, digits, special chars:
strings.ContainsAny(password, "!@#$%") // at least one special char?
```

---

### Q28: How do you check if a string is a valid UTF-8 sequence in Go?

**Answer:**
Use `unicode/utf8.ValidString(s)`:

```go
import "unicode/utf8"

utf8.ValidString("Hello, 世界")  // true
utf8.ValidString("Hello\xff")   // false — 0xFF is not valid UTF-8

// If a string might be invalid, sanitize it:
if !utf8.ValidString(s) {
    s = strings.ToValidUTF8(s, "?") // replace invalid bytes with "?"
}

// Or use the replacement character:
s = strings.ToValidUTF8(s, "\uFFFD") // U+FFFD: 
```

---

### Q29: What does `strings.Title` do and why is it deprecated?

**Answer:**
`strings.Title(s)` capitalizes the first letter of each word. It is **deprecated** since Go 1.18 because it uses the English definition of "word" (split on spaces) and does not handle Unicode correctly for non-English languages.

```go
strings.Title("hello world")    // "Hello World" — works for English
strings.Title("über cool")      // "Über Cool" — may be wrong for some locales
```

**Replacement:** Use `golang.org/x/text/cases`:
```go
import "golang.org/x/text/cases"
import "golang.org/x/text/language"

caser := cases.Title(language.English)
result := caser.String("hello world") // "Hello World"
```

---

### Q30: How does `strings.Fields` differ from `strings.Split(s, " ")` for lines with tabs?

**Answer:**
`strings.Fields` splits on **any Unicode whitespace** including tabs, newlines, form feeds, carriage returns, etc. `strings.Split(s, " ")` only splits on a single ASCII space.

```go
s := "hello\tworld\nfoo"
strings.Fields(s)         // ["hello", "world", "foo"]
strings.Split(s, " ")     // ["hello\tworld\nfoo"] — no split on tab or newline!
strings.Split(s, "\t")    // ["hello", "world\nfoo"] — splits on tab only

// Also: Fields ignores leading/trailing whitespace and consecutive whitespace
strings.Fields("  a  b  c  ") // ["a", "b", "c"]
strings.Split("  a  b  c  ", " ") // ["", "", "a", "", "b", "", "c", "", ""]
```

---

### Q31: Explain the difference between `strings.IndexRune`, `strings.IndexByte`, and `strings.Index`.

**Answer:**
- `strings.IndexByte(s, byte)` — finds the first occurrence of a single byte (fastest, works for ASCII)
- `strings.IndexRune(s, rune)` — finds the first occurrence of a Unicode code point
- `strings.Index(s, substr)` — finds the first occurrence of a substring (can be multi-byte)

```go
s := "café au lait"
strings.IndexByte(s, 'f')       // 2 — byte 'f' at position 2
strings.IndexRune(s, 'é')       // 3 — rune 'é' starts at byte 3
strings.Index(s, "au")          // 6 — substring "au" starts at byte 6

// Performance order (fastest to slowest):
// IndexByte > IndexRune > Index (for single characters)
```

---

### Q32: What is `strings.Cut` and how does it handle the case where the separator is not found?

**Answer:**
`strings.Cut(s, sep)` returns `(before, after string, found bool)`.

- If `sep` is found: `before` = everything before first occurrence, `after` = everything after, `found = true`
- If `sep` is not found: `before = s`, `after = ""`, `found = false`

```go
b, a, ok := strings.Cut("user@example.com", "@")
// b="user", a="example.com", ok=true

b, a, ok = strings.Cut("nodomain", "@")
// b="nodomain", a="", ok=false

// Pattern: parse key=value pairs
func parseKV(s string) (key, value string) {
    key, value, _ = strings.Cut(s, "=")
    return
}
parseKV("name=Alice") // "name", "Alice"
parseKV("flag")       // "flag", ""
```

---

### Q33: How do you repeat a string N times in Go?

**Answer:**
Use `strings.Repeat(s, n)`:

```go
strings.Repeat("ab", 3)   // "ababab"
strings.Repeat("-", 20)   // "--------------------" (20 dashes)
strings.Repeat("🎉", 3)   // "🎉🎉🎉"
strings.Repeat("", 100)   // "" (empty string repeated = empty)
strings.Repeat("x", 0)    // "" (zero repetitions = empty)
```

`strings.Repeat` is more efficient than a loop because it pre-allocates the exact required memory:
```go
// Equivalent to but faster than:
var sb strings.Builder
sb.Grow(len(s) * n)
for i := 0; i < n; i++ { sb.WriteString(s) }
```

---

## Additional Senior-Level Questions

---

### Q34: Explain memory layout differences between `string` and `[]byte` and when the layout matters.

**Answer:**
```
string:   [ptr (8 bytes)][len (8 bytes)]         = 16 bytes
[]byte:   [ptr (8 bytes)][len (8 bytes)][cap (8)] = 24 bytes
```

`string` has no capacity because it cannot grow. The difference matters when:
1. **Struct size:** A struct containing 10 strings is 160 bytes; containing 10 `[]byte` is 240 bytes.
2. **Function parameters:** Passing a string copies 16 bytes; passing `[]byte` copies 24 bytes.
3. **`unsafe` operations:** `reflect.StringHeader` is 2 words; `reflect.SliceHeader` is 3 words.
4. **Alignment:** Both `ptr` and `len/cap` are pointer-sized, so both are 8-byte aligned on 64-bit systems.

---

### Q35: How does Go handle string literals that appear multiple times in code — are they deduplicated?

**Answer:**
String literals are stored in the binary's `.rodata` section. The linker deduplicates identical string literals **within a package** and sometimes across packages (linker-dependent). Two identical string literals in the same Go file are guaranteed to have the same address.

```go
s1 := "hello"
s2 := "hello"
// s1 and s2 have the same Data pointer (same memory address)
// Verified using unsafe.StringData(s1) == unsafe.StringData(s2) → true

// But this is NOT guaranteed by the language spec — it's a compiler optimization
// Do not rely on pointer equality for string comparison
```

This is why `==` is the correct way to compare strings (by value), not pointer comparison.
