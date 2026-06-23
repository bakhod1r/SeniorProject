# Iterating Strings — Interview Questions

## Junior Level

### Q1: What does `for range` yield when iterating over a string in Go?

**A:** It yields `(byteIndex int, r rune)` pairs. The `byteIndex` is the byte position of the start of the character, and `r` is the Unicode rune (character) value — automatically decoded from UTF-8.

```go
for i, r := range "Hi" {
    fmt.Println(i, r) // 0 72, 1 105
}
```

---

### Q2: What is a rune in Go?

**A:** A `rune` is an alias for `int32` and represents a Unicode code point. Every character (letter, digit, emoji, Chinese character, etc.) has a unique rune value.

---

### Q3: What is the difference between `len(s)` and `len([]rune(s))`?

**A:**
- `len(s)` — byte count (number of bytes in the UTF-8 encoding)
- `len([]rune(s))` — character count (number of Unicode code points)

```go
s := "Hello, 世界"
fmt.Println(len(s))          // 13 (bytes)
fmt.Println(len([]rune(s)))  // 9  (characters)
```

---

### Q4: What does `s[i]` return when `s` is a string?

**A:** `s[i]` returns the **byte** at position `i` (type `uint8`/`byte`), NOT the character at position `i`. For ASCII strings these are the same. For multi-byte characters, `s[i]` may return only part of a character.

---

### Q5: How do you get the Nth character (not byte) of a string?

**A:** Convert to `[]rune` and use the index:
```go
s := "Hello, 世界"
runes := []rune(s)
fmt.Println(string(runes[7])) // 世 (8th character)
```

---

### Q6: What is the byte index for the character at position 7 of "Hello, 世界"?

**A:** "Hello, " is 7 bytes (all ASCII), so the 8th character '世' starts at byte index 7. Since '世' is 3 bytes, '界' starts at byte 10. The byte index equals the character index only for ASCII characters.

---

### Q7: How do you reverse a string that may contain Unicode characters?

**A:** Convert to `[]rune`, reverse the rune slice, convert back:
```go
func reverse(s string) string {
    r := []rune(s)
    for i, j := 0, len(r)-1; i < j; i, j = i+1, j-1 {
        r[i], r[j] = r[j], r[i]
    }
    return string(r)
}
```

---

### Q8: How many bytes does the emoji '😀' take?

**A:** 4 bytes. `len("😀")` returns 4, but `len([]rune("😀"))` returns 1.

---

## Middle Level

### Q9: What happens when `for range` encounters invalid UTF-8 in a string?

**A:** Go yields `utf8.RuneError` (U+FFFD, the Unicode replacement character) for each invalid byte, and advances by 1 byte. It does not panic.

```go
for i, r := range "\xff\xfe" {
    fmt.Printf("%d: %U\n", i, r)
}
// 0: U+FFFD
// 1: U+FFFD
```

---

### Q10: Why is string concatenation in a loop bad? What is the alternative?

**A:** Each `s += more` creates a new string allocation, making the total work O(n²) for n concatenations. Use `strings.Builder` instead:

```go
var sb strings.Builder
for _, r := range input {
    sb.WriteRune(r)
}
result := sb.String()
// Total: O(n), 1 final allocation
```

---

### Q11: Why can't you do `s[i] = 'X'` to modify a string in Go?

**A:** Strings in Go are immutable. The backing byte array is in read-only memory. To modify, convert to `[]byte`, modify, then convert back:

```go
b := []byte(s)
b[0] = 'X'
s = string(b)
```

---

### Q12: What is `strings.Builder.Grow()` and when should you use it?

**A:** `Grow(n)` pre-allocates at least `n` more bytes in the builder's buffer. Use it when you know the approximate output size to avoid repeated reallocations:

```go
var sb strings.Builder
sb.Grow(len(input)) // rough capacity hint
for _, r := range input { sb.WriteRune(r) }
```

---

### Q13: What is the difference between `strings.Map` and manually ranging over a string?

**A:** `strings.Map(fn, s)` applies function `fn` to every rune and builds a new string. It is equivalent to manually ranging and collecting with `strings.Builder`. `strings.Map` is more concise and may be slightly optimized internally.

```go
// Using strings.Map
upper := strings.Map(unicode.ToUpper, "hello")

// Equivalent manual:
var sb strings.Builder
for _, r := range "hello" { sb.WriteRune(unicode.ToUpper(r)) }
upper = sb.String()
```

---

### Q14: What is Unicode normalization and why does it matter for string comparison?

**A:** Unicode allows the same visual character to be encoded in multiple ways. For example, 'é' can be:
- Precomposed: U+00E9 (1 code point, 2 bytes)
- Decomposed: U+0065 + U+0301 (2 code points, 3 bytes)

Go's `==` compares bytes, so these are NOT equal. Use `golang.org/x/text/unicode/norm` to normalize before comparison.

---

### Q15: How does `strings.IndexRune` differ from ranging over a string to find a character?

**A:** `strings.IndexRune(s, r)` returns the byte position of the first occurrence of rune `r`. It is more efficient than manual range because it can use optimized string search algorithms internally, and it returns immediately on the first match.

---

## Senior Level

### Q16: Explain the compiler's fast path for ASCII in string range.

**A:** When the compiler encounters `for i, r := range s`, it inserts an ASCII check: if `s[i] < 0x80`, the rune is simply `rune(s[i])` and the index advances by 1. This avoids calling `utf8.DecodeRuneInString`. For purely ASCII strings, the entire loop runs without any function calls, at near-memory-bandwidth speed.

---

### Q17: Why is substring operation (`s[a:b]`) zero-copy?

**A:** A Go string is a 2-word header: `(pointer, length)`. A substring creates a new header pointing into the same backing byte array at a different offset with a smaller length. No bytes are copied. This is safe because strings are immutable.

```go
s := "Hello, World!"
sub := s[7:12] // sub.Data = s.Data + 7, sub.Len = 5
// No allocation!
```

---

### Q18: What is `strings.Clone(s)` (Go 1.20) and when do you need it?

**A:** `strings.Clone` returns a copy of the string with a new backing array. You need it when:
- A small substring keeps a large string's backing array alive (GC concern)
- You want to ensure the string is not shared with other code that might change behavior

```go
large := readLargeFile() // 100MB
small := strings.Clone(large[:10]) // 10-byte copy; 100MB can be GC'd
```

---

### Q19: How does Go handle string hashing for map keys?

**A:** The runtime uses AES-based hashing on platforms with hardware AES support (most modern x86 and ARM chips). The hash combines all bytes of the string with a per-map random seed (`hmap.hash0`). This prevents hash-flooding attacks and provides good distribution.

---

### Q20: What is the performance difference between `for range s` and `utf8.RuneCountInString(s)`?

**A:** `utf8.RuneCountInString` is typically faster because it uses platform-specific SIMD instructions (on amd64) to count rune boundaries in bulk, without the overhead of the range loop's compiler scaffolding and `yield`. For just counting, use `utf8.RuneCountInString`. For processing characters, use `for range`.

---

## Scenario Questions

### Q21: Scenario — Bug in production

A REST API accepts a `summary` field and stores the first 50 characters. Users with Japanese names report their summaries are corrupted. What's wrong?

**A:** The code likely does `s[:50]` which truncates at byte 50, potentially splitting a multi-byte character.

**Fix:**
```go
func first50Chars(s string) string {
    count := 0
    for i := range s {
        if count == 50 { return s[:i] }
        count++
    }
    return s
}
```

---

### Q22: Scenario — Performance

A text processing service spends 40% of its time in `for range` loops over strings. The strings are guaranteed ASCII. How do you optimize?

**A:**
1. Process bytes directly: `for i := 0; i < len(s); i++ { b := s[i] ... }` — no UTF-8 decode overhead.
2. Use `[]byte(s)` once if multiple passes: avoids repeated range decode.
3. Use SIMD-optimized functions from `strings` package for searching/counting.
4. Consider `unsafe.Slice(unsafe.StringData(s), len(s))` for zero-copy byte access.

---

### Q23: Scenario — Design question

Design a `splitAtRune` function that splits a string at every N runes (not N bytes) without converting the entire string to `[]rune`.

**A:**
```go
func splitAtRune(s string, n int) []string {
    var result []string
    start := 0
    count := 0
    for i := range s {
        if count > 0 && count%n == 0 {
            result = append(result, s[start:i])
            start = i
        }
        count++
    }
    if start < len(s) { result = append(result, s[start:]) }
    return result
}
// Uses range to find byte positions, extracts substrings without []rune allocation
```

---

## FAQ

### Q24: Is it safe to range over a string in multiple goroutines simultaneously?

**A:** Yes. Strings are immutable in Go. Multiple goroutines can range over the same string concurrently without synchronization — there are no writes, only reads.

---

### Q25: What is the relationship between `rune` and `int32`?

**A:** `rune` is a type alias for `int32`. They are interchangeable. `rune` is the idiomatic name for Unicode code points in Go. Using `rune` makes code more readable when working with characters.

---

### Q26: Can you range over an empty string?

**A:** Yes. The loop executes 0 times. No panic.

---

### Q27: What does `string(65)` produce?

**A:** `string(65)` creates a string containing the character with Unicode code point 65, which is 'A'. It produces `"A"`.

---

### Q28: Why does `fmt.Println(string([]byte{0xe4, 0xb8, 0x96}))` print `世`?

**A:** The 3 bytes `E4 B8 96` are the UTF-8 encoding of U+4E16 ('世'). `string([]byte{...})` creates a string from those bytes, and `fmt.Println` prints the UTF-8 decoded output to the terminal.

---

### Q29: What is `utf8.ValidString` and when should you use it?

**A:** `utf8.ValidString(s)` returns `true` if and only if `s` consists entirely of valid UTF-8 sequences. Use it when:
- Receiving data from external sources (files, network, user input)
- Before storing to databases that require valid UTF-8
- When `for range` behavior with `RuneError` would be unexpected

---

### Q30: How does Go 1.23's `strings.Lines()` work with `for range`?

**A:** `strings.Lines(s)` (Go 1.23+) returns an `iter.Seq[string]` — a function-based iterator. It yields each line of the string lazily, without building a `[]string`. You can use it directly with `for range`:

```go
for line := range strings.Lines(text) {
    fmt.Println(line)
}
// No intermediate []string allocation — memory efficient for large texts
```
